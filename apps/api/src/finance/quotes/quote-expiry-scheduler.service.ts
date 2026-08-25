import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { QuotesRepository } from './quotes.repository';
import { AuditService } from '../../audit/audit.service';
import { EventBusService } from '../../core/events/event-bus.service';

export const QUOTE_EXPIRY_QUEUE_NAME = 'quote-expiry';
export const QUOTE_EXPIRY_JOB_NAME = 'sweep';
export const QUOTE_EXPIRY_SCHEDULER_ID = 'quote-expiry-sweep';

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Mirrors ReconciliationSchedulerService's JOB_OPTIONS reasoning exactly: each sweep re-derives
 * its worklist from Mongo's current state rather than acting on job data, so a BullMQ retry is
 * just another full sweep against whatever is still eligible — safe to retry without per-entity
 * dedup. 3 attempts is enough headroom for a transient Mongo/Redis blip before the next
 * scheduled tick naturally retries anyway.
 */
const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: false,
} as const;

/**
 * Periodically finds Quotes past their `validUntil` still sitting in a non-terminal status
 * (draft/sent/viewed), transitions them to 'expired', and publishes `quote.expired` via
 * EventBusService — the trigger `quote.expired` was already declared as a valid Workflow trigger
 * (packages/types/src/workflow.ts) and wired into EVENT_ENTITY_ID_FIELD, but nothing ever
 * published it (see docs/lot-q audit and the Wave 2 Agent D final report). A Workflow configured
 * on this trigger was therefore dead — this scheduler is what makes it fire.
 *
 * Architecture is a deliberate copy of ReconciliationSchedulerService (payments/
 * reconciliation-scheduler.service.ts): same BullMQ repeatable-job pattern via
 * upsertJobScheduler (multi-instance safe — one schedule in Redis, exactly one Worker across
 * every API instance wins each tick), same connection-lifecycle error handling, same
 * NODE_ENV=test default-disable with an env override so this file's own e2e test can exercise
 * it live without firing during every other e2e file sharing the same Redis/Mongo. See that
 * file for the full reasoning; only reproduced here where the two diverge (queue/env var names,
 * and the actual sweep body — no external provider, no idempotency-claim orchestration needed
 * since a status transition is either eligible or it isn't).
 */
@Injectable()
export class QuoteExpirySchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(QuoteExpirySchedulerService.name);
  private connection?: IORedis;
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly configService: ConfigService,
    private readonly quotesRepository: QuotesRepository,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBusService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.isEnabled()) {
      this.logger.log('Quote expiry scheduler disabled (test environment)');
      return;
    }

    const intervalMs = this.getIntervalMs();
    this.connection = new IORedis(
      this.configService.getOrThrow<string>('REDIS_URL'),
      { maxRetriesPerRequest: null },
    );
    this.queue = new Queue(QUOTE_EXPIRY_QUEUE_NAME, {
      connection: this.connection,
    });
    this.worker = new Worker(
      QUOTE_EXPIRY_QUEUE_NAME,
      async () => this.runSweep(),
      { connection: this.connection },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(`Quote expiry sweep job ${job?.id} failed`, error);
    });
    // Both the Worker and the Queue need an 'error' handler and a waitUntilReady() before this
    // method resolves — an unhandled connection error on either is otherwise fatal at the
    // process level (see ReconciliationSchedulerService/EventsProcessor for the same note).
    this.worker.on('error', (err) => {
      this.logger.error('Quote expiry queue worker connection error', err);
    });
    this.queue.on('error', (err) => {
      this.logger.error('Quote expiry queue connection error', err);
    });
    await Promise.all([
      this.worker.waitUntilReady(),
      this.queue.waitUntilReady(),
    ]);

    await this.queue.upsertJobScheduler(
      QUOTE_EXPIRY_SCHEDULER_ID,
      { every: intervalMs },
      { name: QUOTE_EXPIRY_JOB_NAME, opts: JOB_OPTIONS },
    );
    this.logger.log(`Quote expiry scheduler started (every ${intervalMs}ms)`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
  }

  /**
   * Each candidate is expired independently — one failing (e.g. a race with the owning user
   * accepting/rejecting it moments earlier, which expireIfEligible's guard already handles as a
   * benign no-op, or an unexpected Mongo error) must never abort the rest of the sweep.
   */
  private async runSweep(): Promise<void> {
    this.logger.log('Quote expiry sweep starting');
    const candidates = await this.quotesRepository.findExpirable();
    let expired = 0;

    for (const candidate of candidates) {
      try {
        const updated = await this.quotesRepository.expireIfEligible(
          candidate.organizationId.toString(),
          candidate.id as string,
        );
        if (!updated) continue; // no longer eligible — a concurrent transition already resolved it

        expired += 1;
        await this.auditService.record({
          organizationId: candidate.organizationId.toString(),
          action: 'UPDATE',
          entity: 'quote',
          entityId: candidate.id as string,
          metadata: { status: 'expired', automated: true },
        });
        await this.eventBus.publish(
          candidate.organizationId.toString(),
          'quote.expired',
          {
            quoteId: candidate.id as string,
            contactId: candidate.contactId.toString(),
            total: candidate.total,
          },
        );
      } catch (error) {
        this.logger.error(
          `Quote expiry sweep: failed on Quote ${candidate.id as string}`,
          error,
        );
      }
    }

    this.logger.log(
      `Quote expiry sweep finished: candidates=${candidates.length} expired=${expired}`,
    );
  }

  private isEnabled(): boolean {
    const override = this.configService.get<string>('QUOTE_EXPIRY_ENABLED');
    if (override !== undefined) return override === 'true';
    return this.configService.get<string>('NODE_ENV') !== 'test';
  }

  private getIntervalMs(): number {
    const raw = this.configService.get<string>('QUOTE_EXPIRY_INTERVAL_MS');
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INTERVAL_MS;
  }
}
