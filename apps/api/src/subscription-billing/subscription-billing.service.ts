import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubscriptionInvoicesRepository } from '../subscriptions/subscription-invoices.repository';
import { SubscriptionsRepository } from '../subscriptions/subscriptions.repository';
import { PaymentMandatesRepository } from '../subscriptions/payment-mandates.repository';
import { PaymentProviderResolverService } from '../finance/payments/providers/payment-provider-resolver.service';
import { AuditService } from '../audit/audit.service';

export interface CheckoutResult {
  invoiceNumber: string;
  checkoutUrl: string;
  providerReference: string;
}

/**
 * Collection for KORVA's own SaaS invoices ("Flow A" — see
 * docs/architecture/integrations-platform.md §4). SubscriptionPeriodSchedulerService issues the
 * invoices; this service is how they actually get paid.
 *
 * Lives in its own module rather than inside SubscriptionsModule purely for import-graph
 * reasons: it needs both SubscriptionInvoicesRepository (SubscriptionsModule) and
 * PaymentProviderResolverService (IntegrationsModule), and SubscriptionsModule cannot import
 * IntegrationsModule — IntegrationsModule imports OrganizationsModule, which imports
 * SubscriptionsModule back. SubscriptionBillingModule importing both closes no cycle, so no
 * forwardRef() is needed anywhere.
 */
@Injectable()
export class SubscriptionBillingService {
  private readonly logger = new Logger(SubscriptionBillingService.name);

  constructor(
    private readonly invoicesRepository: SubscriptionInvoicesRepository,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly paymentMandatesRepository: PaymentMandatesRepository,
    private readonly paymentProviderResolver: PaymentProviderResolverService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Returns a hosted checkout URL for one open invoice, creating it on first request and
   * reusing it afterwards. Deliberately on demand rather than minted at issuance time: the
   * payer's email is the requesting user's own, which the background sweep does not have, and a
   * link generated weeks earlier for a checkout nobody opened is worth less than a fresh one.
   */
  async createCheckout(
    organizationId: string,
    invoiceId: string,
    payerEmail: string,
  ): Promise<CheckoutResult> {
    const invoice = await this.invoicesRepository.findOwnedById(
      organizationId,
      invoiceId,
    );
    if (!invoice) {
      throw new NotFoundException({
        code: 'SUBSCRIPTION_INVOICE_NOT_FOUND',
        message: 'Subscription invoice not found',
      });
    }
    if (invoice.status !== 'open') {
      throw new UnprocessableEntityException({
        code: 'SUBSCRIPTION_INVOICE_NOT_PAYABLE',
        message: `This invoice is ${invoice.status} — only an open invoice can be paid`,
      });
    }

    // An existing, still-unpaid checkout is reused rather than replaced: minting a second
    // provider transaction for the same invoice is how double payments happen.
    if (invoice.checkoutUrl && invoice.providerReference) {
      return {
        invoiceNumber: invoice.number,
        checkoutUrl: invoice.checkoutUrl,
        providerReference: invoice.providerReference,
      };
    }

    const provider = await this.paymentProviderResolver.resolve({
      flow: 'subscription',
      organizationId,
    });

    const result = await provider.createPayment({
      amount: invoice.amount,
      currency: invoice.currency,
      // The adapters use this purely as a human-readable prefix on the merchant reference
      // (`korva_<invoiceId>_<random>`), never as a foreign key — so the invoice NUMBER is both
      // valid and far more useful here than its ObjectId.
      invoiceId: invoice.number,
      customerEmail: payerEmail,
      redirectUrl: `${this.appUrl()}/dashboard/settings?subscriptionInvoice=${invoice.number}`,
    });

    if (!result.checkoutUrl) {
      // Every real adapter returns one; ManualPaymentProvider does not, because no hosted
      // checkout exists for it. Fail loudly rather than returning a success with no URL.
      throw new UnprocessableEntityException({
        code: 'SUBSCRIPTION_CHECKOUT_UNAVAILABLE',
        message:
          'The configured subscription-billing provider does not offer a hosted checkout',
      });
    }

    const updated = await this.invoicesRepository.attachCheckout(
      organizationId,
      invoiceId,
      result.providerReference,
      result.checkoutUrl,
      payerEmail,
    );

    await this.auditService.record({
      organizationId,
      action: 'UPDATE',
      entity: 'subscription',
      entityId: invoiceId,
      metadata: {
        reason: 'subscription_invoice_checkout_created',
        invoiceNumber: invoice.number,
        provider: provider.name,
      },
    });

    return {
      invoiceNumber: invoice.number,
      // `updated` can only be null if the invoice stopped being open between the two writes —
      // the values just sent to the provider are still the correct ones to hand back.
      checkoutUrl: updated?.checkoutUrl ?? result.checkoutUrl,
      providerReference: updated?.providerReference ?? result.providerReference,
    };
  }

  /**
   * Asks the provider what actually happened to an invoice's checkout and marks the invoice paid
   * if it completed. KORVA never infers payment from the payer returning to `redirectUrl` — the
   * provider's own answer is the only evidence, the same "HTTP 200 ≠ paid" invariant the
   * Paystack/Flutterwave adapters state for tenant commerce payments.
   */
  async verifyPayment(
    organizationId: string,
    invoiceId: string,
  ): Promise<{ invoiceNumber: string; status: string }> {
    const invoice = await this.invoicesRepository.findOwnedById(
      organizationId,
      invoiceId,
    );
    if (!invoice) {
      throw new NotFoundException({
        code: 'SUBSCRIPTION_INVOICE_NOT_FOUND',
        message: 'Subscription invoice not found',
      });
    }
    if (invoice.status !== 'open') {
      return { invoiceNumber: invoice.number, status: invoice.status };
    }
    if (!invoice.providerReference) {
      throw new UnprocessableEntityException({
        code: 'SUBSCRIPTION_INVOICE_NO_CHECKOUT',
        message:
          'No payment has been started for this invoice — request a checkout link first',
      });
    }

    const provider = await this.paymentProviderResolver.resolve({
      flow: 'subscription',
      organizationId,
    });
    // verifyPayment rather than getPaymentStatus: the full result is what carries
    // `mandateReference`, and this is the ONLY moment a reusable authorization is observable —
    // the provider returns it on the verify response for the checkout the payer just completed,
    // and never again.
    const result = await provider.verifyPayment(invoice.providerReference);
    const status = result.status;

    if (result.mandateReference) {
      // Best-effort and deliberately non-fatal: failing to store a mandate must never turn a
      // genuinely successful payment into an error. The worst case is that the next renewal
      // falls back to an invoice with a payment link, which is the behavior without any mandate
      // at all.
      try {
        await this.paymentMandatesRepository.capture({
          organizationId,
          provider: provider.name,
          reference: result.mandateReference,
          payerEmail: invoice.payerEmail ?? '',
        });
      } catch (error) {
        this.logger.error(
          `Failed to store payment mandate for organization ${organizationId}`,
          error,
        );
      }
    }

    if (status !== 'completed') {
      this.logger.log(
        `Subscription invoice ${invoice.number} still unpaid at provider (status=${status})`,
      );
      return { invoiceNumber: invoice.number, status: 'open' };
    }

    await this.settleAsPaid(organizationId, invoiceId, invoice.number, {
      provider: provider.name,
      collection: 'checkout',
    });
    return { invoiceNumber: invoice.number, status: 'paid' };
  }

  /**
   * The single definition of "this subscription invoice got paid", shared by the
   * payer-completed-a-checkout path above and the unattended card-on-file sweep
   * (SubscriptionAutoChargeSchedulerService). Kept in one place deliberately: duplicating it
   * would put the decision of whether a payment also ends a suspension in two places, and they
   * would eventually disagree.
   *
   * markPaidIfOpen is guarded on status:'open', so replaying this — a double click, a sweep
   * racing a manual verification — returns null and does nothing rather than overwriting the
   * original paidAt. Returns whether this call was the one that settled it.
   */
  async settleAsPaid(
    organizationId: string,
    invoiceId: string,
    invoiceNumber: string,
    context: Record<string, unknown>,
  ): Promise<boolean> {
    const paid = await this.invoicesRepository.markPaidIfOpen(
      organizationId,
      invoiceId,
    );
    if (!paid) return false;

    await this.auditService.record({
      organizationId,
      action: 'UPDATE',
      entity: 'subscription',
      entityId: invoiceId,
      metadata: {
        reason: 'subscription_invoice_paid',
        invoiceNumber,
        ...context,
      },
    });

    // Paying the overdue invoice is what ends a suspension. No-op (null) when the subscription
    // was never past_due, which is the common case — an invoice paid on time.
    const reactivated =
      await this.subscriptionsRepository.reactivateFromPastDue(organizationId);
    if (reactivated) {
      await this.auditService.record({
        organizationId,
        action: 'UPDATE',
        entity: 'subscription',
        entityId: reactivated.id as string,
        metadata: {
          status: 'active',
          reason: 'subscription_invoice_paid_after_past_due',
          invoiceNumber,
        },
      });
    }
    return true;
  }

  private appUrl(): string {
    return this.configService.get<string>('APP_URL') ?? 'http://localhost:3000';
  }
}
