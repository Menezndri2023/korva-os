import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import {
  addPlanInterval,
  normalizePlanInterval,
  type PlanInterval,
} from '@korva/types';
import { SubscriptionsRepository } from './subscriptions.repository';
import { SubscriptionInvoicesRepository } from './subscription-invoices.repository';
import { PlansRepository } from './plans.repository';
import { SubscriptionDocument } from './schemas/subscription.schema';
import { AuditService } from '../audit/audit.service';
import { CountersService } from '../core/counters/counters.service';
import { backgroundWorkersDisabled } from '../core/background/background-workers';
import { SubscriptionsService } from './subscriptions.service';

export const SUBSCRIPTION_PERIOD_QUEUE_NAME = 'subscription-period';
export const SUBSCRIPTION_PERIOD_JOB_NAME = 'sweep';
export const SUBSCRIPTION_PERIOD_SCHEDULER_ID = 'subscription-period-sweep';

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

/** See QuoteExpirySchedulerService's JOB_OPTIONS — identical reasoning, applied to subscriptions. */
const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: false,
} as const;

/** Days a tenant has to pay a SubscriptionInvoice before the next sweep moves the subscription
 *  to 'past_due'. Overridable via SUBSCRIPTION_INVOICE_GRACE_DAYS. */
const DEFAULT_GRACE_DAYS = 7;

/** What one renewal attempt actually did — the sweep aggregates these for its summary log. */
interface RenewalOutcome {
  renewed: boolean;
  invoiced: boolean;
  pastDue: boolean;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Periodically finds Subscriptions past their `currentPeriodEnd` still 'active', and resolves
 * each one of two ways, entirely without any real payment collection (no PSP integration exists
 * yet — see docs/architecture-decisions.md and the Wave 2.1 Agent C final report):
 *
 *  - `cancelAtPeriodEnd: true` (a cancel-at-period-end request is pending) -> transitions to
 *    'canceled'. This is the terminal step of POST /subscriptions/cancel with immediate:false.
 *  - `cancelAtPeriodEnd: false` -> renewal, which now branches on the plan's own price:
 *      - `priceAmount <= 0` (free plan): advance the period, stay 'active', issue nothing. This
 *        is byte-for-byte the old behavior — a free tier still never expires.
 *      - `priceAmount > 0` (paid plan): KORVA bills the tenant for the upcoming period by
 *        issuing a `SubscriptionInvoice` (invoice-first, the same shape
 *        RecurringBillingSchedulerService already uses for tenant-side recurring billing), then
 *        advances the period. If the PREVIOUS period's invoice is still 'open' past its
 *        `dueAt` grace window, the subscription moves to 'past_due' instead and the period is
 *        not advanced — the tenant did not pay for another period, so it does not get one.
 *
 * Why invoice-first rather than charging a card here: neither real adapter can do a
 * server-initiated recurring charge. PaystackProvider.createPayment calls
 * /transaction/initialize and FlutterwaveProvider returns `data.link` — both are HOSTED
 * CHECKOUT flows whose status is always 'pending' until a human completes a redirect, and
 * nothing in this codebase stores a reusable card authorization/mandate. Calling createPayment
 * from a background sweep would therefore mint a checkout URL nobody ever opens and strand
 * every paid subscription in 'past_due'. Collecting against an issued invoice (payment link on
 * demand) is the mechanism that actually works today.
 *
 * Architecture is a deliberate copy of ReconciliationSchedulerService (finance/payments/
 * reconciliation-scheduler.service.ts) and its siblings QuoteExpirySchedulerService /
 * InvoiceOverdueSchedulerService — same BullMQ repeatable-job pattern via upsertJobScheduler
 * (multi-instance safe), same connection-lifecycle error handling, same NODE_ENV=test
 * default-disable with an env override for this file's own e2e test. See those files for the
 * full reasoning; only reproduced here where they diverge (queue/env var names, and the sweep
 * body itself, which branches in two directions instead of one).
 *
 * NOTE ON EVENTS: quote.expired/invoice.overdue publish through EventBusService because they
 * were already declared as valid SystemEvent/Workflow-trigger names in
 * packages/types/src/workflow.ts. Adding subscription.renewed/subscription.canceled the same way
 * would require extending that same SYSTEM_EVENTS union (packages/types/src/workflow.ts) and its
 * companion EVENT_ENTITY_ID_FIELD map (apps/api/src/core/events/event-names.ts) — both outside
 * this module's ownership boundary for this round (see the final report, section 9/10). Every
 * transition is still recorded via AuditService (the same mechanism the reference schedulers use
 * alongside their event publish) so it's fully observable; wiring the two real SystemEvent names
 * in is a small, mechanical follow-up once whoever owns those files picks it up.
 */
@Injectable()
export class SubscriptionPeriodSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SubscriptionPeriodSchedulerService.name);
  private connection?: IORedis;
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly configService: ConfigService,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly subscriptionInvoicesRepository: SubscriptionInvoicesRepository,
    private readonly plansRepository: PlansRepository,
    private readonly countersService: CountersService,
    private readonly auditService: AuditService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.isEnabled()) {
      this.logger.log(
        'Subscription period scheduler disabled (test environment)',
      );
      return;
    }

    const intervalMs = this.getIntervalMs();
    this.connection = new IORedis(
      this.configService.getOrThrow<string>('REDIS_URL'),
      { maxRetriesPerRequest: null },
    );
    this.queue = new Queue(SUBSCRIPTION_PERIOD_QUEUE_NAME, {
      connection: this.connection,
    });
    this.worker = new Worker(
      SUBSCRIPTION_PERIOD_QUEUE_NAME,
      async () => this.runSweep(),
      { connection: this.connection },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(
        `Subscription period sweep job ${job?.id} failed`,
        error,
      );
    });
    this.worker.on('error', (err) => {
      this.logger.error(
        'Subscription period queue worker connection error',
        err,
      );
    });
    this.queue.on('error', (err) => {
      this.logger.error('Subscription period queue connection error', err);
    });
    await Promise.all([
      this.worker.waitUntilReady(),
      this.queue.waitUntilReady(),
    ]);

    await this.queue.upsertJobScheduler(
      SUBSCRIPTION_PERIOD_SCHEDULER_ID,
      { every: intervalMs },
      { name: SUBSCRIPTION_PERIOD_JOB_NAME, opts: JOB_OPTIONS },
    );
    this.logger.log(
      `Subscription period scheduler started (every ${intervalMs}ms)`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
  }

  /**
   * Each candidate is resolved independently — one failing (e.g. a race with the owning user
   * canceling/reactivating moments earlier, which cancelIfEligible/renewIfEligible's guards
   * already handle as a benign no-op, or an unexpected Mongo error) must never abort the rest of
   * the sweep.
   */
  private async runSweep(): Promise<void> {
    this.logger.log('Subscription period sweep starting');
    // Expired signup trials first: entitlements already read the billed plan the moment a trial
    // ends (SubscriptionsService.getActivePlan), this only brings enabledModules in line.
    try {
      const settled = await this.subscriptionsService.settleExpiredTrials();
      if (settled > 0) this.logger.log(`Settled ${settled} expired trial(s)`);
    } catch (error) {
      this.logger.error(
        'Subscription period sweep: settling trials failed',
        error,
      );
    }
    const candidates =
      await this.subscriptionsRepository.findRenewalCandidates();
    let canceled = 0;
    let renewed = 0;
    let pastDue = 0;
    let invoiced = 0;

    for (const candidate of candidates) {
      try {
        if (candidate.cancelAtPeriodEnd) {
          const updated = await this.resolveCancellation(candidate);
          if (updated) canceled += 1;
        } else {
          const outcome = await this.resolveRenewal(candidate);
          if (outcome.renewed) renewed += 1;
          if (outcome.pastDue) pastDue += 1;
          if (outcome.invoiced) invoiced += 1;
        }
      } catch (error) {
        this.logger.error(
          `Subscription period sweep: failed on Subscription ${candidate.id as string}`,
          error,
        );
      }
    }

    this.logger.log(
      `Subscription period sweep finished: candidates=${candidates.length} canceled=${canceled} renewed=${renewed} invoiced=${invoiced} pastDue=${pastDue}`,
    );
  }

  private async resolveCancellation(
    candidate: SubscriptionDocument,
  ): Promise<boolean> {
    const organizationId = candidate.organizationId.toString();
    const updated = await this.subscriptionsRepository.cancelIfEligible(
      organizationId,
      candidate.id as string,
    );
    if (!updated) return false; // no longer eligible — reactivated concurrently

    await this.auditService.record({
      organizationId,
      action: 'UPDATE',
      entity: 'subscription',
      entityId: candidate.id as string,
      metadata: { status: 'canceled', automated: true, reason: 'period_end' },
    });
    return true;
  }

  /**
   * A paid plan only gets another period once the previous one was paid for. Order matters:
   * the invoice for the upcoming period is issued BEFORE the period is advanced, so a crash
   * between the two re-runs safely — the unique (subscriptionId, periodStart) index turns the
   * second issuance into a no-op and the renewal is simply retried on the next tick.
   */
  private async resolveRenewal(
    candidate: SubscriptionDocument,
  ): Promise<RenewalOutcome> {
    const organizationId = candidate.organizationId.toString();
    const plan = await this.plansRepository.findById(
      candidate.planId.toString(),
    );

    // A subscription whose plan no longer exists cannot be priced. Never guess an amount and
    // never silently grant a free period — surface it and leave the row untouched for a human.
    if (!plan) {
      throw new Error(
        `Subscription ${candidate.id as string} references Plan ${candidate.planId.toString()}, which no longer exists — cannot price its renewal`,
      );
    }

    // Free plan: no money is owed, so there is nothing to invoice and nothing that could fail
    // to be paid. Advance the period and stay 'active', exactly as before this method ever
    // knew about invoices.
    // The next period is as long as the plan's own duration: 1, 6 or 12 months.
    const interval = normalizePlanInterval(plan.interval);

    if (plan.priceAmount <= 0) {
      const renewed = await this.renewPeriod(
        candidate,
        organizationId,
        interval,
      );
      return { renewed, invoiced: false, pastDue: false };
    }

    const previous =
      await this.subscriptionInvoicesRepository.findLatestForSubscription(
        candidate.id as string,
      );

    // The previous period was billed and never paid, and its grace window has run out.
    if (
      previous &&
      previous.status === 'open' &&
      previous.dueAt.getTime() < Date.now()
    ) {
      const updated = await this.subscriptionsRepository.markPastDueIfEligible(
        organizationId,
        candidate.id as string,
      );
      if (!updated) return { renewed: false, invoiced: false, pastDue: false };

      await this.auditService.record({
        organizationId,
        action: 'UPDATE',
        entity: 'subscription',
        entityId: candidate.id as string,
        metadata: {
          status: 'past_due',
          automated: true,
          reason: 'subscription_invoice_unpaid',
          unpaidInvoiceNumber: previous.number,
        },
      });
      return { renewed: false, invoiced: false, pastDue: true };
    }

    // Advance from the period's own end (not "now") so a late-running sweep never shortens or
    // drifts the next period — matches changePlan()'s one-month convention.
    const newPeriodStart = candidate.currentPeriodEnd;
    const newPeriodEnd = addPlanInterval(candidate.currentPeriodEnd, interval);
    const issuedAt = new Date();

    // A mid-period changePlan() stores the price delta for the overlap it created
    // (SubscriptionsService#computeProration) and resets the period. Folding that delta into
    // the next invoice is the right move for an invoice-first model: issuing a second invoice
    // mid-period would send the tenant another payment link for what is often a few units of
    // currency. Currency is re-checked rather than assumed — computeProration stores the plan's
    // currency at the time of the change, and a later plan price-currency change would desync
    // it; mixing currencies in one amount is never acceptable.
    const proration =
      candidate.prorationAmount !== null &&
      candidate.prorationCurrency === plan.priceCurrency
        ? candidate.prorationAmount
        : 0;
    // Never a negative invoice. A credit larger than the period's price is clamped, and the
    // unapplied remainder is surfaced in the audit entry rather than silently swallowed —
    // carrying it forward would need a real credit-balance concept, which does not exist here.
    const rawAmount = plan.priceAmount + proration;
    const amount = Math.max(0, Math.round(rawAmount * 100) / 100);
    const unappliedCredit =
      rawAmount < 0 ? Math.round(rawAmount * -100) / 100 : 0;

    // A credit that fully covers the period leaves nothing to bill. Issuing a zero-amount
    // invoice would hand the tenant a checkout link for nothing, so this takes the same path a
    // free plan does: advance the period, issue nothing, and still consume the proration.
    if (amount === 0) {
      const renewed = await this.renewPeriod(
        candidate,
        organizationId,
        interval,
      );
      await this.consumeProration(candidate, organizationId, proration, {
        reason: 'subscription_period_fully_covered_by_credit',
        planAmount: plan.priceAmount,
        prorationApplied: proration,
        unappliedCredit,
      });
      return { renewed, invoiced: false, pastDue: false };
    }

    const invoice = await this.subscriptionInvoicesRepository.issueForPeriod({
      organizationId: candidate.organizationId,
      subscriptionId: candidate._id,
      planId: candidate.planId,
      number: await this.countersService.nextFormatted(
        organizationId,
        'subscription-invoice',
        'ABO',
      ),
      periodStart: newPeriodStart,
      periodEnd: newPeriodEnd,
      amount,
      currency: plan.priceCurrency,
      issuedAt,
      dueAt: addDays(issuedAt, this.getGraceDays()),
    });

    // `null` means this period's invoice already existed (a retried sweep) — success, not
    // failure. Either way the period may now be advanced.
    if (invoice) {
      await this.auditService.record({
        organizationId,
        action: 'CREATE',
        entity: 'subscription',
        entityId: candidate.id as string,
        metadata: {
          automated: true,
          reason: 'subscription_invoice_issued',
          invoiceNumber: invoice.number,
          amount: invoice.amount,
          currency: invoice.currency,
          planAmount: plan.priceAmount,
          prorationApplied: proration,
          unappliedCredit,
        },
      });
    }

    // Only after the invoice exists: if issuance had failed, the proration must still be there
    // for the next sweep to apply.
    await this.consumeProration(candidate, organizationId, proration, null);

    const renewed = await this.renewPeriod(candidate, organizationId, interval);
    return { renewed, invoiced: invoice !== null, pastDue: false };
  }

  /**
   * Clears a proration that has been billed, and optionally records why. `appliedAmount` of 0
   * means there was nothing to apply (no proration, or a currency mismatch), in which case
   * there is nothing to clear either — a currency-mismatched proration is deliberately LEFT in
   * place rather than discarded, so it is still visible for a human to resolve.
   */
  private async consumeProration(
    candidate: SubscriptionDocument,
    organizationId: string,
    appliedAmount: number,
    auditMetadata: Record<string, unknown> | null,
  ): Promise<void> {
    if (appliedAmount !== 0) {
      await this.subscriptionsRepository.clearAppliedProration(
        organizationId,
        candidate.id as string,
        appliedAmount,
      );
    }
    if (auditMetadata) {
      await this.auditService.record({
        organizationId,
        action: 'UPDATE',
        entity: 'subscription',
        entityId: candidate.id as string,
        metadata: { automated: true, ...auditMetadata },
      });
    }
  }

  private async renewPeriod(
    candidate: SubscriptionDocument,
    organizationId: string,
    interval: PlanInterval,
  ): Promise<boolean> {
    const newPeriodStart = candidate.currentPeriodEnd;
    const newPeriodEnd = addPlanInterval(candidate.currentPeriodEnd, interval);

    const updated = await this.subscriptionsRepository.renewIfEligible(
      organizationId,
      candidate.id as string,
      newPeriodStart,
      newPeriodEnd,
    );
    if (!updated) return false; // no longer eligible — canceled concurrently, or already renewed

    await this.auditService.record({
      organizationId,
      action: 'UPDATE',
      entity: 'subscription',
      entityId: candidate.id as string,
      metadata: {
        automated: true,
        reason: 'period_renewed',
        currentPeriodStart: newPeriodStart.toISOString(),
        currentPeriodEnd: newPeriodEnd.toISOString(),
      },
    });
    return true;
  }

  private getGraceDays(): number {
    const raw = this.configService.get<string>(
      'SUBSCRIPTION_INVOICE_GRACE_DAYS',
    );
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_GRACE_DAYS;
  }

  private isEnabled(): boolean {
    // A CLI script building an application context must not start background work —
    // see core/background/background-workers.ts.
    if (backgroundWorkersDisabled(this.configService)) return false;
    const override = this.configService.get<string>(
      'SUBSCRIPTION_PERIOD_ENABLED',
    );
    if (override !== undefined) return override === 'true';
    return this.configService.get<string>('NODE_ENV') !== 'test';
  }

  private getIntervalMs(): number {
    const raw = this.configService.get<string>(
      'SUBSCRIPTION_PERIOD_INTERVAL_MS',
    );
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INTERVAL_MS;
  }
}
