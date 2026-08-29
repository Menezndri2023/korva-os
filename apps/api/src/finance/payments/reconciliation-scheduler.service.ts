import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { PaymentReconciliationService } from './payment-reconciliation.service';

export const RECONCILIATION_QUEUE_NAME = 'payment-reconciliation';
export const RECONCILIATION_JOB_NAME = 'sweep';
export const RECONCILIATION_SCHEDULER_ID = 'payment-reconciliation-sweep';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Each sweep re-derives its worklist from Mongo's current 'processing' state rather than
 * acting on job data, so a BullMQ retry of a failed sweep is just another full sweep against
 * whatever is still pending — safe to retry without the jobId/eventKey dedup EventBusService
 * needs for its per-entity jobs (see EventBusService.publish). 3 attempts (vs Lot Q's 5) is
 * enough headroom for a transient Mongo/Redis blip; the next scheduled tick (~5 min by default)
 * is already a natural retry for anything that doesn't clear within these attempts.
 */
const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: false,
} as const;

/**
 * Periodically calls PaymentReconciliationService.reconcilePendingPayments()/
 * reconcilePendingRefunds() so Payments/Refunds stuck in 'processing' (e.g. a crash between the
 * provider call and the Mongo write) eventually resolve without a human triggering it manually.
 * A BullMQ repeatable job that hands off to those two methods — no financial logic lives here.
 *
 * Multi-instance safety: `upsertJobScheduler` registers ONE repeatable schedule keyed by
 * RECONCILIATION_SCHEDULER_ID in Redis, not per-process — every API instance calling this on
 * startup upserts the SAME schedule (idempotent by id), and BullMQ/Redis produces exactly one
 * job per tick regardless of how many instances are running. Every Worker across every instance
 * then competes for that single job via BullMQ's atomic Redis job fetch (the same mechanism
 * EventsProcessor already relies on for the 'events' queue), so exactly one instance executes
 * each sweep — no application-level/Mongo lock needed.
 *
 * Disabled by default when NODE_ENV=test — the full e2e suite boots ~20 separate
 * NestApplications against the SAME Redis/Mongo, several of which deliberately leave a Payment/
 * Refund 'processing' expecting it to stay that way; a live sweep firing mid-suite against
 * ManualPaymentProvider (which reports every reference 'completed' unconditionally) would
 * finalize those on a timer no test controls. PAYMENT_RECONCILIATION_ENABLED overrides this so
 * the scheduler itself can be exercised in its own dedicated test (see
 * payment-reconciliation-scheduler.e2e-spec.ts).
 */
@Injectable()
export class ReconciliationSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ReconciliationSchedulerService.name);
  private connection?: IORedis;
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly configService: ConfigService,
    private readonly reconciliationService: PaymentReconciliationService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.isEnabled()) {
      this.logger.log(
        'Payment/Refund reconciliation scheduler disabled (test environment)',
      );
      return;
    }

    const intervalMs = this.getIntervalMs();
    this.connection = new IORedis(
      this.configService.getOrThrow<string>('REDIS_URL'),
      { maxRetriesPerRequest: null },
    );
    this.queue = new Queue(RECONCILIATION_QUEUE_NAME, {
      connection: this.connection,
    });
    this.worker = new Worker(
      RECONCILIATION_QUEUE_NAME,
      async () => this.runSweep(),
      { connection: this.connection },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(`Reconciliation sweep job ${job?.id} failed`, error);
    });
    // See EventsProcessor for why both the Worker and the Queue need an 'error' handler and a
    // waitUntilReady() before this method resolves: an unhandled connection error on either
    // (surfaced by BullMQ's own close() internals) is otherwise fatal at the process level.
    this.worker.on('error', (err) => {
      this.logger.error('Reconciliation queue worker connection error', err);
    });
    this.queue.on('error', (err) => {
      this.logger.error('Reconciliation queue connection error', err);
    });
    await Promise.all([
      this.worker.waitUntilReady(),
      this.queue.waitUntilReady(),
    ]);

    await this.queue.upsertJobScheduler(
      RECONCILIATION_SCHEDULER_ID,
      { every: intervalMs },
      { name: RECONCILIATION_JOB_NAME, opts: JOB_OPTIONS },
    );
    this.logger.log(
      `Payment/Refund reconciliation scheduler started (every ${intervalMs}ms)`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
  }

  /**
   * Payments and Refunds are swept independently — one failing never skips the other. A failure
   * from either is rethrown only AFTER both ran, so BullMQ still marks the job 'failed' for
   * visibility (retried on the next scheduled tick, same as any other candidate would be).
   * PaymentReconciliationService already catches and logs every per-candidate error
   * (provider/Mongo) internally, so this only throws on something at the query level itself
   * (e.g. Mongo unreachable) — never because a single candidate was bad.
   */
  private async runSweep(): Promise<void> {
    this.logger.log('Reconciliation sweep starting');
    let failure: unknown;

    try {
      const payments =
        await this.reconciliationService.reconcilePendingPayments();
      this.logger.log(
        `Payments swept: processed=${payments.processed} completed=${payments.completed} ` +
          `failed=${payments.failed} stillProcessing=${payments.stillProcessing} ` +
          `unreconcilable=${payments.unreconcilable}`,
      );
    } catch (error) {
      this.logger.error('Reconciliation sweep: Payments sweep failed', error);
      failure = error;
    }

    try {
      const refunds =
        await this.reconciliationService.reconcilePendingRefunds();
      this.logger.log(
        `Refunds swept: processed=${refunds.processed} completed=${refunds.completed} ` +
          `failed=${refunds.failed} stillProcessing=${refunds.stillProcessing} ` +
          `unreconcilable=${refunds.unreconcilable}`,
      );
    } catch (error) {
      this.logger.error('Reconciliation sweep: Refunds sweep failed', error);
      failure ??= error;
    }

    if (failure)
      throw failure instanceof Error
        ? failure
        : new Error('Reconciliation sweep failed', { cause: failure });
  }

  private isEnabled(): boolean {
    const override = this.configService.get<string>(
      'PAYMENT_RECONCILIATION_ENABLED',
    );
    if (override !== undefined) return override === 'true';
    return this.configService.get<string>('NODE_ENV') !== 'test';
  }

  private getIntervalMs(): number {
    const raw = this.configService.get<string>(
      'PAYMENT_RECONCILIATION_INTERVAL_MS',
    );
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INTERVAL_MS;
  }
}
