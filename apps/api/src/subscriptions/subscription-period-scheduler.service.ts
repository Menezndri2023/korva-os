import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { SubscriptionsRepository } from './subscriptions.repository';
import { SubscriptionDocument } from './schemas/subscription.schema';
import { AuditService } from '../audit/audit.service';

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

function addOneMonth(date: Date): Date {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + 1);
  return result;
}

/**
 * Periodically finds Subscriptions past their `currentPeriodEnd` still 'active', and resolves
 * each one of two ways, entirely without any real payment collection (no PSP integration exists
 * yet — see docs/architecture-decisions.md and the Wave 2.1 Agent C final report):
 *
 *  - `cancelAtPeriodEnd: true` (a cancel-at-period-end request is pending) -> transitions to
 *    'canceled'. This is the terminal step of POST /subscriptions/cancel with immediate:false.
 *  - `cancelAtPeriodEnd: false` -> this is where real renewal/re-billing would happen once a PSP
 *    exists. For now, the correct provider-agnostic behavior is to simply advance
 *    currentPeriodStart/currentPeriodEnd by one billing cycle and leave status 'active' —
 *    preserving today's "free tier never expires" behavior while adding the scaffolding a future
 *    PSP integration hooks into (e.g. attempting a charge here first, and only renewing on
 *    success — falling through to 'past_due' on failure instead).
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
    private readonly auditService: AuditService,
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
    const candidates =
      await this.subscriptionsRepository.findRenewalCandidates();
    let canceled = 0;
    let renewed = 0;

    for (const candidate of candidates) {
      try {
        if (candidate.cancelAtPeriodEnd) {
          const updated = await this.resolveCancellation(candidate);
          if (updated) canceled += 1;
        } else {
          const updated = await this.resolveRenewal(candidate);
          if (updated) renewed += 1;
        }
      } catch (error) {
        this.logger.error(
          `Subscription period sweep: failed on Subscription ${candidate.id as string}`,
          error,
        );
      }
    }

    this.logger.log(
      `Subscription period sweep finished: candidates=${candidates.length} canceled=${canceled} renewed=${renewed}`,
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

  private async resolveRenewal(
    candidate: SubscriptionDocument,
  ): Promise<boolean> {
    const organizationId = candidate.organizationId.toString();
    // Advance from the period's own end (not "now") so a late-running sweep never shortens or
    // drifts the next period — matches changePlan()'s one-month convention.
    const newPeriodStart = candidate.currentPeriodEnd;
    const newPeriodEnd = addOneMonth(candidate.currentPeriodEnd);

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

  private isEnabled(): boolean {
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
