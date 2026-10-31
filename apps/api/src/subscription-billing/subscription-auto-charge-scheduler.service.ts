import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { SubscriptionInvoicesRepository } from '../subscriptions/subscription-invoices.repository';
import { PaymentMandatesRepository } from '../subscriptions/payment-mandates.repository';
import { PaymentProviderResolverService } from '../finance/payments/providers/payment-provider-resolver.service';
import { isAmbiguousProviderError } from '../finance/payments/providers/payment-provider.interface';
import { SubscriptionBillingService } from './subscription-billing.service';
import type { SubscriptionInvoiceDocument } from '../subscriptions/schemas/subscription-invoice.schema';
import { backgroundWorkersDisabled } from '../core/background/background-workers';

export const SUBSCRIPTION_AUTO_CHARGE_QUEUE_NAME = 'subscription-auto-charge';
export const SUBSCRIPTION_AUTO_CHARGE_JOB_NAME = 'sweep';
export const SUBSCRIPTION_AUTO_CHARGE_SCHEDULER_ID =
  'subscription-auto-charge-sweep';

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

/** See QuoteExpirySchedulerService's JOB_OPTIONS — identical reasoning. */
const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: false,
} as const;

/**
 * Charges open SubscriptionInvoices against a stored card-on-file mandate, with no payer
 * present — the piece that turns KORVA's own billing from "we send a payment link every month"
 * into real recurring billing.
 *
 * **Why this is a separate sweep from SubscriptionPeriodSchedulerService rather than a branch
 * inside it.** Two reasons, one structural and one about design:
 *
 *  - Structural: the renewal sweep lives in SubscriptionsModule, which cannot import
 *    IntegrationsModule (IntegrationsModule -> OrganizationsModule -> SubscriptionsModule is a
 *    real cycle), so it cannot resolve a payment provider at all.
 *  - Design: issuing an invoice and collecting it are different jobs with different failure
 *    modes. Keeping them apart means a provider outage delays collection without ever blocking
 *    a renewal, each retries on its own schedule, and the fallback needs no code — an invoice
 *    this sweep could not charge simply stays open with the payment link it already has, which
 *    is exactly the behavior from before card-on-file existed.
 *
 * **What it refuses to do.** It never charges twice. The provider reference is derived from the
 * invoice number and is therefore stable across retries, so a provider that deduplicates by
 * reference sees one attempt. An ambiguous provider error (a timeout where no response ever
 * arrived) leaves the invoice, the mandate and the subscription completely untouched: the
 * charge may have succeeded, and treating that as a failure is how a customer gets billed
 * twice. Only a provider-confirmed `'failed'` revokes the mandate.
 */
@Injectable()
export class SubscriptionAutoChargeSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    SubscriptionAutoChargeSchedulerService.name,
  );
  private connection?: IORedis;
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly configService: ConfigService,
    private readonly invoicesRepository: SubscriptionInvoicesRepository,
    private readonly mandatesRepository: PaymentMandatesRepository,
    private readonly paymentProviderResolver: PaymentProviderResolverService,
    private readonly billingService: SubscriptionBillingService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.isEnabled()) {
      this.logger.log(
        'Subscription auto-charge scheduler disabled (test environment)',
      );
      return;
    }

    const intervalMs = this.getIntervalMs();
    this.connection = new IORedis(
      this.configService.getOrThrow<string>('REDIS_URL'),
      { maxRetriesPerRequest: null },
    );
    this.queue = new Queue(SUBSCRIPTION_AUTO_CHARGE_QUEUE_NAME, {
      connection: this.connection,
    });
    this.worker = new Worker(
      SUBSCRIPTION_AUTO_CHARGE_QUEUE_NAME,
      async () => this.runSweep(),
      { connection: this.connection },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(
        `Subscription auto-charge sweep job ${job?.id} failed`,
        error,
      );
    });
    this.worker.on('error', (err) => {
      this.logger.error('Subscription auto-charge worker error', err);
    });
    this.queue.on('error', (err) => {
      this.logger.error('Subscription auto-charge queue error', err);
    });
    await Promise.all([
      this.worker.waitUntilReady(),
      this.queue.waitUntilReady(),
    ]);

    await this.queue.upsertJobScheduler(
      SUBSCRIPTION_AUTO_CHARGE_SCHEDULER_ID,
      { every: intervalMs },
      { name: SUBSCRIPTION_AUTO_CHARGE_JOB_NAME, opts: JOB_OPTIONS },
    );
    this.logger.log(
      `Subscription auto-charge scheduler started (every ${intervalMs}ms)`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
  }

  /** One invoice failing must never abort the rest — same per-candidate isolation as every
   *  other sweep in this codebase. */
  private async runSweep(): Promise<void> {
    this.logger.log('Subscription auto-charge sweep starting');
    const invoices = await this.invoicesRepository.findOpen();
    let charged = 0;
    let declined = 0;
    let skipped = 0;

    for (const invoice of invoices) {
      try {
        const outcome = await this.chargeOne(invoice);
        if (outcome === 'charged') charged += 1;
        else if (outcome === 'declined') declined += 1;
        else skipped += 1;
      } catch (error) {
        this.logger.error(
          `Subscription auto-charge: failed on invoice ${invoice.number}`,
          error,
        );
      }
    }

    this.logger.log(
      `Subscription auto-charge sweep finished: open=${invoices.length} charged=${charged} declined=${declined} skipped=${skipped}`,
    );
  }

  private async chargeOne(
    invoice: SubscriptionInvoiceDocument,
  ): Promise<'charged' | 'declined' | 'skipped'> {
    const organizationId = invoice.organizationId.toString();

    // A plan change is paid by the person who asked for it (and may be abandoned): never
    // charged in the background.
    if (invoice.kind === 'plan_change') return 'skipped';

    // The business chose to pay its plan from its Solde KORVA: tried first, no card needed.
    if (await this.billingService.tryAutoPayFromWallet(invoice))
      return 'charged';

    // A provider that is not configured for subscription billing throws
    // PAYMENT_PROVIDER_NOT_CONFIGURED by design. That is a normal state for a deployment that
    // has not set it up yet, not an error worth a stack trace every hour, so it is a skip.
    let provider;
    try {
      provider = await this.paymentProviderResolver.resolve({
        flow: 'subscription',
        organizationId,
      });
    } catch {
      return 'skipped';
    }

    // Optionality of chargeRecurring is load-bearing — ManualPaymentProvider has nothing to
    // call, and a mobile-money-only adapter may never implement it. Nothing is wrong here; this
    // deployment simply collects by payment link.
    if (!provider.chargeRecurring) return 'skipped';

    const mandate = await this.mandatesRepository.findActiveDecrypted(
      organizationId,
      provider.name,
    );
    if (!mandate) return 'skipped';

    // Derived from the invoice number, so it is identical on every retry of this invoice: a
    // provider that deduplicates by reference can recognize a repeated attempt instead of
    // creating a second charge.
    const reference = `korva_auto_${invoice.number}`;

    let result;
    try {
      result = await provider.chargeRecurring({
        mandateReference: mandate.reference,
        amount: invoice.amount,
        currency: invoice.currency,
        reference,
        customerEmail: mandate.payerEmail,
      });
    } catch (error) {
      if (isAmbiguousProviderError(error)) {
        // The charge may have gone through. Changing ANYTHING here — marking the invoice,
        // revoking the mandate — risks either a double charge on the next sweep or a customer
        // locked out of a subscription they paid for. The next sweep retries with the same
        // reference, which is the safe resolution.
        this.logger.warn(
          `Subscription auto-charge for invoice ${invoice.number} returned an ambiguous outcome; left untouched for the next sweep`,
        );
        return 'skipped';
      }
      throw error;
    }

    if (result.status === 'completed') {
      await this.billingService.settleAsPaid(
        organizationId,
        invoice.id as string,
        invoice.number,
        {
          provider: provider.name,
          collection: 'auto_charge',
          providerReference: result.providerReference,
        },
      );
      await this.mandatesRepository.markUsed(mandate.id);
      return 'charged';
    }

    // A provider-confirmed decline. The mandate is revoked rather than retried forever: an
    // expired or withdrawn card will decline every hour until someone intervenes, and the
    // invoice is still collectable through the payment link it already carries.
    await this.mandatesRepository.revoke(
      mandate.id,
      `provider reported status "${result.status}" for invoice ${invoice.number}`,
    );
    this.logger.warn(
      `Subscription auto-charge declined for invoice ${invoice.number}; mandate revoked, invoice remains payable by link`,
    );
    return 'declined';
  }

  private isEnabled(): boolean {
    // A CLI script building an application context must not start background work —
    // see core/background/background-workers.ts.
    if (backgroundWorkersDisabled(this.configService)) return false;
    const override = this.configService.get<string>(
      'SUBSCRIPTION_AUTO_CHARGE_ENABLED',
    );
    if (override !== undefined) return override === 'true';
    return this.configService.get<string>('NODE_ENV') !== 'test';
  }

  private getIntervalMs(): number {
    const raw = this.configService.get<string>(
      'SUBSCRIPTION_AUTO_CHARGE_INTERVAL_MS',
    );
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INTERVAL_MS;
  }
}
