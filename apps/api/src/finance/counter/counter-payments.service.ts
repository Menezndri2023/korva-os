import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { CounterPayment } from '@korva/types';
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
