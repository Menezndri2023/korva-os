import { randomUUID } from 'node:crypto';
import { intlLocaleOf, translator } from '../../shared/i18n';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  minimumOnlinePayment,
  onlinePaymentTermsAccepted,
  type CounterPayment,
} from '@korva/types';
import type { CreateCounterPaymentInput } from '@korva/validation';
import {
  Contact,
  type ContactDocument,
} from '../../crm/contacts/schemas/contact.schema';
import { ContactsService } from '../../crm/contacts/contacts.service';
import { OrganizationsService } from '../../organizations/organizations.service';
import { InvoicesService } from '../invoices/invoices.service';
import {
  Invoice,
  type InvoiceDocument,
} from '../invoices/schemas/invoice.schema';
import { PaymentsService } from '../payments/payments.service';
import {
  Payment,
  type PaymentDocument,
} from '../payments/schemas/payment.schema';
import { PaymentProviderResolverService } from '../payments/providers/payment-provider-resolver.service';

/** Every counter sale's Payment carries this idempotency-key prefix — it is how they are listed. */
const KEY_PREFIX = 'counter:';
/** The CRM contact every counter sale is invoiced to: the customer is a passer-by. */
const WALK_IN_TAG = 'client-comptoir';
const DEFAULT_LABEL = 'Vente au comptoir';

/**
 * The counter QR code: staff type an amount, KORVA issues a one-line invoice and a GeniusPay
 * payment, and the customer scans GeniusPay's page with their phone and pays by mobile money.
 * Everything after that is the ordinary online-payment path — the webhook (or the reconciliation
 * sweep) completes the payment, the invoice is marked paid and the Solde KORVA is credited.
 */
@Injectable()
export class CounterPaymentsService {
  private readonly logger = new Logger(CounterPaymentsService.name);

  constructor(
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    @InjectModel(Invoice.name)
    private readonly invoiceModel: Model<InvoiceDocument>,
    @InjectModel(Contact.name)
    private readonly contactModel: Model<ContactDocument>,
    private readonly contactsService: ContactsService,
    private readonly invoicesService: InvoicesService,
    private readonly paymentsService: PaymentsService,
    private readonly organizationsService: OrganizationsService,
    private readonly paymentProviderResolver: PaymentProviderResolverService,
  ) {}

  async create(
    organizationId: string,
    userId: string,
    input: CreateCounterPaymentInput,
  ): Promise<CounterPayment> {
    const organization =
      await this.organizationsService.getById(organizationId);
    // The QR at the counter is KORVA's online payment too: the business's choice, terms accepted.
    if (!onlinePaymentTermsAccepted(organization.onlinePaymentTerms)) {
      throw new BadRequestException({
        code: 'ONLINE_PAYMENT_TERMS_REQUIRED',
        message:
          'Accept the online payment terms in your Settings to take mobile money payments',
      });
    }
    let provider;
    try {
      provider = await this.paymentProviderResolver.resolve({
        flow: 'commerce',
        organizationId,
      });
    } catch {
      throw new BadRequestException({
        code: 'ONLINE_PAYMENT_NOT_AVAILABLE',
        message: 'Mobile money payment is not available for this business yet.',
      });
    }
    if (
      provider.supportedCurrencies &&
      !provider.supportedCurrencies.includes(
        organization.currency.toUpperCase(),
      )
    ) {
      throw new BadRequestException({
        code: 'CURRENCY_NOT_CHARGEABLE',
        message: `Mobile money payment is not available in ${organization.currency}.`,
      });
    }
    // Checked before the invoice exists, so a refused amount leaves nothing behind
    // (PaymentsService enforces the same floor for every online payment).
    const minimum = minimumOnlinePayment(organization.currency);
    if (input.amount < minimum) {
      throw new BadRequestException({
        code: 'ONLINE_PAYMENT_BELOW_MINIMUM',
        message: `Online payment starts at ${minimum} ${organization.currency}`,
        minimum,
      });
    }

    const contact = await this.walkInContact(organizationId);
    const draft = await this.invoicesService.create(organizationId, userId, {
      contactId: contact.id as string,
      currency: organization.currency,
      items: [
        {
          description: input.label || DEFAULT_LABEL,
          quantity: 1,
          unitPrice: input.amount,
          taxRate: 0,
        },
      ],
    });
    const invoice = await this.invoicesService.issue(
      organizationId,
      userId,
      draft.id as string,
    );

    const storefrontUrl = (
      process.env.STOREFRONT_URL ?? 'http://localhost:3001'
    ).replace(/\/$/, '');
    const payment = await this.paymentsService.create(
      organizationId,
      userId,
      {
        invoiceId: invoice.id as string,
        amount: invoice.total,
        method: 'online',
      },
      `${KEY_PREFIX}${randomUUID()}`,
      { provider, redirectUrl: `${storefrontUrl}/${organization.slug}` },
    );
    if (!payment.checkoutUrl) {
      throw new BadRequestException({
        code: 'ONLINE_PAYMENT_NOT_AVAILABLE',
        message: 'Unable to start a mobile money payment right now.',
      });
    }
    return this.toView(payment, invoice);
  }

  /** The cashier's screen polls this: an unresolved payment is checked with GeniusPay first. */
  async get(
    organizationId: string,
    paymentId: string,
  ): Promise<CounterPayment> {
    let payment = await this.findCounterPayment(organizationId, paymentId);
    if (
      (payment.status === 'pending' || payment.status === 'processing') &&
      payment.providerReference
    ) {
      try {
        payment = await this.paymentsService.reconcileProcessingPayment(
          organizationId,
          paymentId,
        );
      } catch (error) {
        // GeniusPay unreachable: the screen asks again, and the webhook may still arrive.
        this.logger.warn(
          `Counter payment ${paymentId}: status check failed (${error instanceof Error ? error.message : String(error)})`,
        );
      }
    }
    const invoice = await this.invoiceModel
      .findOne({
        _id: payment.invoiceId,
        organizationId: payment.organizationId,
      })
      .exec();
    return this.toView(payment, invoice);
  }

  async listRecent(
    organizationId: string,
    limit = 20,
  ): Promise<CounterPayment[]> {
    const payments = await this.paymentModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
        idempotencyKey: { $regex: `^${KEY_PREFIX}` },
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
    const invoices = await this.invoiceModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
        _id: { $in: payments.map((payment) => payment.invoiceId) },
      })
      .exec();
    const byId = new Map(
      invoices.map((invoice) => [String(invoice._id), invoice]),
    );
    return payments.map((payment) =>
      this.toView(payment, byId.get(String(payment.invoiceId)) ?? null),
    );
  }

  private async findCounterPayment(
    organizationId: string,
    paymentId: string,
  ): Promise<PaymentDocument> {
    const payment = Types.ObjectId.isValid(paymentId)
      ? await this.paymentModel
          .findOne({
            _id: new Types.ObjectId(paymentId),
            organizationId: new Types.ObjectId(organizationId),
            idempotencyKey: { $regex: `^${KEY_PREFIX}` },
          })
          .exec()
      : null;
    if (!payment) {
      throw new NotFoundException({
        code: 'PAYMENT_NOT_FOUND',
        message: 'Payment not found',
      });
    }
    return payment;
  }

  /** Found by tag, created on the first counter sale. */
  /**
   * A cash sale typed at the till: a one-line invoice to the walk-in customer, paid in cash at
   * once. `key` is the till's own id for the sale — a sale typed while the connection was down
   * is sent later, maybe twice; the same key always answers the same sale, never a second one.
   * `soldAt` is when it was typed: a sale sent long after says so on its line.
   */
  async recordCashSale(
    organizationId: string,
    userId: string,
    input: { amount: number; label?: string; key: string; soldAt?: string },
  ): Promise<{
    invoiceId: string;
    invoiceNumber: string;
    amount: number;
    replayed: boolean;
  }> {
    const idempotencyKey = `counter-cash:${input.key}`;
    const existing = await this.paymentsService.findByIdempotencyKey(
      organizationId,
      idempotencyKey,
    );
    if (existing) {
      const invoice = await this.invoiceModel
        .findById(existing.invoiceId)
        .exec();
      return {
        invoiceId: existing.invoiceId.toString(),
        invoiceNumber: invoice?.number ?? '',
        amount: existing.amount,
        replayed: true,
      };
    }
    const organization =
      await this.organizationsService.getById(organizationId);
    const soldAt = input.soldAt ? new Date(input.soldAt) : null;
    const late = soldAt && Date.now() - soldAt.getTime() > 5 * 60_000;
    const t = translator(organization.language);
    const label =
      (input.label || DEFAULT_LABEL) +
      (late
        ? t(
            ` (vendu le ${soldAt.toLocaleString(intlLocaleOf(organization.language), { timeZone: organization.timezone, dateStyle: 'short', timeStyle: 'short' })}, hors connexion)`,
            ` (sold ${soldAt.toLocaleString(intlLocaleOf(organization.language), { timeZone: organization.timezone, dateStyle: 'short', timeStyle: 'short' })}, offline)`,
          )
        : '');
    const contact = await this.walkInContact(organizationId);
    const draft = await this.invoicesService.create(organizationId, userId, {
      contactId: contact.id as string,
      currency: organization.currency,
      items: [
        {
          description: label.slice(0, 300),
          quantity: 1,
          unitPrice: input.amount,
          taxRate: 0,
        },
      ],
    });
    const invoice = await this.invoicesService.issue(
      organizationId,
      userId,
      draft.id as string,
    );
    await this.paymentsService.create(
      organizationId,
      userId,
      {
        invoiceId: invoice.id as string,
        amount: invoice.total,
        method: 'cash',
      },
      idempotencyKey,
    );
    return {
      invoiceId: invoice.id as string,
      invoiceNumber: invoice.number,
      amount: invoice.total,
      replayed: false,
    };
  }

  private async walkInContact(
    organizationId: string,
  ): Promise<ContactDocument> {
    const existing = await this.contactModel
      .findOne({
        organizationId: new Types.ObjectId(organizationId),
        tags: WALK_IN_TAG,
      })
      .exec();
    if (existing) return existing;
    return this.contactsService.create(organizationId, undefined, {
      type: 'person',
      firstName: 'Client',
      lastName: 'au comptoir',
      tags: [WALK_IN_TAG],
    });
  }

  private toView(
    payment: PaymentDocument,
    invoice: InvoiceDocument | null,
  ): CounterPayment {
    return {
      id: payment.id as string,
      invoiceId: String(payment.invoiceId),
      invoiceNumber: invoice?.number ?? '',
      label: invoice?.items[0]?.description ?? DEFAULT_LABEL,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      checkoutUrl: payment.checkoutUrl,
      createdAt: (
        payment as unknown as { createdAt: Date }
      ).createdAt.toISOString(),
    };
  }
}
