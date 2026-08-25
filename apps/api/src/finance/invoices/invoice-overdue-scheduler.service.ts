import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { InvoicesRepository } from './invoices.repository';
import { AuditService } from '../../audit/audit.service';
import { EventBusService } from '../../core/events/event-bus.service';

export const INVOICE_OVERDUE_QUEUE_NAME = 'invoice-overdue';
export const INVOICE_OVERDUE_JOB_NAME = 'sweep';
export const INVOICE_OVERDUE_SCHEDULER_ID = 'invoice-overdue-sweep';

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

/** See QuoteExpirySchedulerService's JOB_OPTIONS — identical reasoning, applied to invoices. */
const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: false,
} as const;

/**
 * Periodically finds Invoices past their `dueDate` still carrying an outstanding balance
 * ('issued'/'partially_paid'), transitions them to 'overdue', and publishes `invoice.overdue`
 * via EventBusService — `invoice.overdue` was already declared as a valid Workflow trigger
 * (packages/types/src/workflow.ts) and wired into EVENT_ENTITY_ID_FIELD, but nothing ever
 * published it (see docs/lot-q audit and the Wave 2 Agent D final report). A Workflow configured
 * on this trigger was therefore dead — this scheduler is what makes it fire.
 *
 * Architecture is a deliberate copy of ReconciliationSchedulerService (payments/
 * reconciliation-scheduler.service.ts) and its sibling QuoteExpirySchedulerService — same BullMQ
 * repeatable-job pattern via upsertJobScheduler (multi-instance safe), same connection-lifecycle
 * error handling, same NODE_ENV=test default-disable with an env override for this file's own
 * e2e test. See those files for the full reasoning; only reproduced here where they diverge
 * (queue/env var names, and the sweep body itself).
 */
@Injectable()
export class InvoiceOverdueSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(InvoiceOverdueSchedulerService.name);
  private connection?: IORedis;
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly configService: ConfigService,
    private readonly invoicesRepository: InvoicesRepository,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBusService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.isEnabled()) {
      this.logger.log('Invoice overdue scheduler disabled (test environment)');
      return;
    }

    const intervalMs = this.getIntervalMs();
    this.connection = new IORedis(
      this.configService.getOrThrow<string>('REDIS_URL'),
      { maxRetriesPerRequest: null },
    );
    this.queue = new Queue(INVOICE_OVERDUE_QUEUE_NAME, {
      connection: this.connection,
    });
    this.worker = new Worker(
      INVOICE_OVERDUE_QUEUE_NAME,
      async () => this.runSweep(),
      { connection: this.connection },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(`Invoice overdue sweep job ${job?.id} failed`, error);
    });
    this.worker.on('error', (err) => {
      this.logger.error('Invoice overdue queue worker connection error', err);
    });
    this.queue.on('error', (err) => {
      this.logger.error('Invoice overdue queue connection error', err);
    });
    await Promise.all([
      this.worker.waitUntilReady(),
      this.queue.waitUntilReady(),
    ]);

    await this.queue.upsertJobScheduler(
      INVOICE_OVERDUE_SCHEDULER_ID,
      { every: intervalMs },
      { name: INVOICE_OVERDUE_JOB_NAME, opts: JOB_OPTIONS },
    );
    this.logger.log(
      `Invoice overdue scheduler started (every ${intervalMs}ms)`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
  }

  /**
   * Each candidate is marked independently — one failing (e.g. a race with a payment/cancel
   * moments earlier, which markOverdueIfEligible's guard already handles as a benign no-op, or
   * an unexpected Mongo error) must never abort the rest of the sweep.
   */
  private async runSweep(): Promise<void> {
    this.logger.log('Invoice overdue sweep starting');
    const candidates = await this.invoicesRepository.findOverdueCandidates();
    let marked = 0;

    for (const candidate of candidates) {
      try {
        const updated = await this.invoicesRepository.markOverdueIfEligible(
          candidate.organizationId.toString(),
          candidate.id as string,
        );
        if (!updated) continue; // no longer eligible — a concurrent transition already resolved it

        marked += 1;
        await this.auditService.record({
          organizationId: candidate.organizationId.toString(),
          action: 'UPDATE',
          entity: 'invoice',
          entityId: candidate.id as string,
          metadata: { status: 'overdue', automated: true },
        });
        await this.eventBus.publish(
          candidate.organizationId.toString(),
          'invoice.overdue',
          {
            invoiceId: candidate.id as string,
            contactId: candidate.contactId.toString(),
            total: candidate.total,
            amountPaid: candidate.amountPaid,
          },
        );
      } catch (error) {
        this.logger.error(
          `Invoice overdue sweep: failed on Invoice ${candidate.id as string}`,
          error,
        );
      }
    }

    this.logger.log(
      `Invoice overdue sweep finished: candidates=${candidates.length} marked=${marked}`,
    );
  }

  private isEnabled(): boolean {
    const override = this.configService.get<string>('INVOICE_OVERDUE_ENABLED');
    if (override !== undefined) return override === 'true';
    return this.configService.get<string>('NODE_ENV') !== 'test';
  }

  private getIntervalMs(): number {
    const raw = this.configService.get<string>('INVOICE_OVERDUE_INTERVAL_MS');
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INTERVAL_MS;
  }
}
