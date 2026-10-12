import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { ResourcesRepository } from './resources.repository';
import { safeFetch } from '../../shared/safe-fetch';
import { parseIcsEvents } from '../../shared/ics';
import { AuditService } from '../../audit/audit.service';
import { backgroundWorkersDisabled } from '../../core/background/background-workers';

export const CALENDAR_SYNC_QUEUE_NAME = 'calendar-sync';
export const CALENDAR_SYNC_JOB_NAME = 'sweep';
export const CALENDAR_SYNC_SCHEDULER_ID = 'calendar-sync-sweep';

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000; // 15min — frequent enough that a newly-booked personal appointment blocks availability soon after it's added to the external calendar

const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: false,
} as const;

/**
 * Periodically fetches every Resource's `externalCalendarUrl` (an ICS feed — see
 * resource.schema.ts) and replaces its `source: 'external_calendar'` blocked slots with what the
 * feed currently says, so a staff member's personal Google/Outlook/Apple calendar blocks KORVA
 * booking availability too (one-way import only — see docs/BUSINESS_OS_AUDIT.md roadmap item #8;
 * full two-way OAuth sync needs real Google/Microsoft app credentials this environment doesn't
 * have). Same BullMQ repeatable-job pattern as every other scheduler in this codebase (see
 * CustomerInactivitySchedulerService for the fully-annotated original) — one difference: a feed
 * fetch failure for one resource (network error, malformed ICS, URL now unsafe) must never abort
 * the sweep for the others, so every per-resource step is individually try/caught.
 */
@Injectable()
export class CalendarSyncSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(CalendarSyncSchedulerService.name);
  private connection?: IORedis;
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly configService: ConfigService,
    private readonly resourcesRepository: ResourcesRepository,
    private readonly auditService: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.isEnabled()) {
      this.logger.log('Calendar sync scheduler disabled (test environment)');
      return;
    }

    const intervalMs = this.getIntervalMs();
    this.connection = new IORedis(
      this.configService.getOrThrow<string>('REDIS_URL'),
      { maxRetriesPerRequest: null },
    );
    this.queue = new Queue(CALENDAR_SYNC_QUEUE_NAME, {
      connection: this.connection,
    });
    this.worker = new Worker(
      CALENDAR_SYNC_QUEUE_NAME,
      async () => this.runSweep(),
      { connection: this.connection },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(`Calendar sync sweep job ${job?.id} failed`, error);
    });
    this.worker.on('error', (err) => {
      this.logger.error('Calendar sync queue worker connection error', err);
    });
    this.queue.on('error', (err) => {
      this.logger.error('Calendar sync queue connection error', err);
    });
    await Promise.all([
      this.worker.waitUntilReady(),
      this.queue.waitUntilReady(),
    ]);

    await this.queue.upsertJobScheduler(
      CALENDAR_SYNC_SCHEDULER_ID,
      { every: intervalMs },
      { name: CALENDAR_SYNC_JOB_NAME, opts: JOB_OPTIONS },
    );
    this.logger.log(`Calendar sync scheduler started (every ${intervalMs}ms)`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
  }

  async runSweep(): Promise<void> {
    const resources =
      await this.resourcesRepository.findAllWithExternalCalendar();
    this.logger.log(
      `Calendar sync sweep starting: resources=${resources.length}`,
    );

    let synced = 0;
    for (const resource of resources) {
      const resourceId = String(resource._id);
      const organizationId = resource.organizationId.toString();
      try {
        if (!resource.externalCalendarUrl) continue;
        const response = await safeFetch(resource.externalCalendarUrl, {
          method: 'GET',
        });
        if (!response.ok) {
          this.logger.warn(
            `Calendar sync: feed fetch failed for resource ${resourceId} (status ${response.status})`,
          );
          continue;
        }
        const body = await response.text();
        const events = parseIcsEvents(body);
        const slots = events.map((event) => ({
          startAt: event.startAt,
          endAt: event.endAt,
          source: 'external_calendar' as const,
        }));

        await this.resourcesRepository.replaceExternalCalendarBlockedSlots(
          organizationId,
          resourceId,
          slots,
        );
        synced += 1;
        await this.auditService.record({
          organizationId,
          action: 'UPDATE',
          entity: 'resource',
          entityId: resourceId,
          metadata: {
            event: 'calendar.synced',
            automated: true,
            slotCount: slots.length,
          },
        });
      } catch (error) {
        this.logger.error(
          `Calendar sync sweep: failed on resource ${resourceId}`,
          error,
        );
      }
    }

    this.logger.log(
      `Calendar sync sweep finished: resources=${resources.length} synced=${synced}`,
    );
  }

  private isEnabled(): boolean {
    // A CLI script building an application context must not start background work —
    // see core/background/background-workers.ts.
    if (backgroundWorkersDisabled(this.configService)) return false;
    const override = this.configService.get<string>('CALENDAR_SYNC_ENABLED');
    if (override !== undefined) return override === 'true';
    return this.configService.get<string>('NODE_ENV') !== 'test';
  }

  private getIntervalMs(): number {
    const raw = this.configService.get<string>('CALENDAR_SYNC_INTERVAL_MS');
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INTERVAL_MS;
  }
}
