import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConversationsService } from '../../communication/conversations/conversations.service';
import { sendWithChannelFallback } from '../../communication/notify-contact-with-fallback';
import { ContactsService } from '../../crm/contacts/contacts.service';
import { OrganizationsService } from '../../organizations/organizations.service';
import { EntitlementsService } from '../../subscriptions/entitlements.service';
import { PaymentsService } from '../payments/payments.service';
import { PaymentProviderResolverService } from '../payments/providers/payment-provider-resolver.service';
import { Invoice, type InvoiceDocument } from './schemas/invoice.schema';
import { intlLocaleOf, translator } from '../../shared/i18n';

/** Every reminder's payment link carries this key: one link per invoice, however often asked. */
const KEY_PREFIX = 'reminder:';

function money(amount: number, currency: string, intl = 'fr-FR'): string {
  return new Intl.NumberFormat(intl, {
    style: 'currency',
    currency,
    maximumFractionDigits: currency.toUpperCase() === 'XOF' ? 0 : 2,
  }).format(amount);
}

/**
 * Pro (plan feature `payment_reminders`): when an invoice becomes overdue, its customer gets one
 * message — WhatsApp first, e-mail otherwise — with a mobile money link to pay the remainder when
 * the business can take online payment. Called by InvoiceOverdueSchedulerService right after the
 * invoice turns overdue, so it rides that existing sweep instead of adding another queue.
 *
 * Best effort and never throws: a customer with no phone and no e-mail, or a provider outage,
 * leaves the invoice overdue exactly as before.
 */
@Injectable()
export class InvoiceReminderService {
  private readonly logger = new Logger(InvoiceReminderService.name);

  constructor(
    @InjectModel(Invoice.name)
    private readonly invoiceModel: Model<InvoiceDocument>,
    private readonly entitlementsService: EntitlementsService,
    private readonly organizationsService: OrganizationsService,
    private readonly contactsService: ContactsService,
    private readonly conversationsService: ConversationsService,
    private readonly paymentsService: PaymentsService,
    private readonly paymentProviderResolver: PaymentProviderResolverService,
  ) {}

  /** Returns the channel used, or undefined when nothing was sent. */
  async remindOverdue(
    organizationId: string,
    invoiceId: string,
  ): Promise<'whatsapp' | 'email' | undefined> {
    try {
      if (
        !(await this.entitlementsService.hasFeature(
          organizationId,
          'payment_reminders',
        ))
      ) {
        return undefined;
      }
      const invoice = await this.invoiceModel.findOne({
        _id: new Types.ObjectId(invoiceId),
        organizationId: new Types.ObjectId(organizationId),
        status: 'overdue',
        reminderSentAt: { $exists: false },
      });
      if (!invoice) return undefined;
      const remaining =
        Math.round((invoice.total - invoice.amountPaid) * 100) / 100;
      if (remaining <= 0) return undefined;

      const [organization, contact] = await Promise.all([
        this.organizationsService.getById(organizationId),
        this.contactsService.getById(
          organizationId,
          invoice.contactId.toString(),
        ),
      ]);
      const link = await this.paymentLink(
        organizationId,
        organization.slug,
        invoiceId,
        remaining,
        organization.currency,
      );
      // In the business's language (shared/i18n.ts).
      const t = translator(organization.language);
      const greeting = contact.firstName
        ? t(`Bonjour ${contact.firstName},`, `Hello ${contact.firstName},`)
        : t('Bonjour,', 'Hello,');
      const amount = money(
        remaining,
        invoice.currency,
        intlLocaleOf(organization.language),
      );
      const body = [
        t(
          `${greeting} la facture ${invoice.number} de ${organization.name} (${amount} restant à payer) est arrivée à échéance.`,
          `${greeting} invoice ${invoice.number} from ${organization.name} (${amount} still to pay) is now due.`,
        ),
        link
          ? t(
              `Vous pouvez la régler par mobile money ici : ${link}`,
              `You can pay it by mobile money or card here: ${link}`,
            )
          : organization.contactPhone
            ? t(
                `Pour la régler, contactez-nous au ${organization.contactPhone}.`,
                `To pay it, contact us on ${organization.contactPhone}.`,
              )
            : t(
                'Merci de nous contacter pour la régler.',
                'Please contact us to pay it.',
              ),
      ].join(' ');

      const channel = await sendWithChannelFallback(
        this.conversationsService,
        this.logger,
        organizationId,
        invoice.contactId.toString(),
        body,
        `Overdue reminder for invoice ${invoiceId}`,
      );
      if (channel) {
        await this.invoiceModel.updateOne(
          { _id: invoice._id },
          { $set: { reminderSentAt: new Date(), reminderChannel: channel } },
        );
      }
      return channel;
    } catch (error) {
      this.logger.warn(
        `Overdue reminder for invoice ${invoiceId} not sent: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  /** A GeniusPay page for the remainder, or undefined when online payment is not available. */
  private async paymentLink(
    organizationId: string,
    slug: string,
    invoiceId: string,
    amount: number,
    currency: string,
  ): Promise<string | undefined> {
    try {
      const provider = await this.paymentProviderResolver.resolve({
        flow: 'commerce',
        organizationId,
      });
      if (
        provider.supportedCurrencies &&
        !provider.supportedCurrencies.includes(currency.toUpperCase())
      ) {
        return undefined;
      }
      const storefrontUrl = (
        process.env.STOREFRONT_URL ?? 'http://localhost:3001'
      ).replace(/\/$/, '');
      const payment = await this.paymentsService.create(
        organizationId,
        undefined,
        { invoiceId, amount, method: 'online' },
        `${KEY_PREFIX}${invoiceId}`,
        { provider, redirectUrl: `${storefrontUrl}/${slug}` },
      );
      return payment.checkoutUrl;
    } catch {
      return undefined;
    }
  }
}
