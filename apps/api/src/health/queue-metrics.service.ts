import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { EVENTS_QUEUE_NAME } from '../core/events/event-names';
import { RECONCILIATION_QUEUE_NAME } from '../finance/payments/reconciliation-scheduler.service';

export interface QueueCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

export type QueueMetrics = Record<string, QueueCounts>;

const QUEUE_NAMES = [EVENTS_QUEUE_NAME, RECONCILIATION_QUEUE_NAME];

/**
 * Read-only observation of the two existing BullMQ queues ('events',
 * 'payment-reconciliation') for GET /health/queues. Deliberately does NOT reuse
 * EventBusService's/EventsProcessor's/ReconciliationSchedulerService's own Queue/Worker
 * instances — those are private fields with no accessor, and reaching into them would mean
 * modifying Lot Q / the reconciliation scheduler, which this service must never do. Instead
 * it opens its own lightweight Queue clients, pointed at the same queue names over the same
 * REDIS_URL, used for exactly one thing: getJobCounts(). Never .add(), never a Worker, never
 * any other Redis write — the same pattern any external queue dashboard uses to observe a
 * queue without touching its producer/consumer.
 *
 * Only aggregate counts ever leave this service. getFailed()/getJobs()/getJob() are
 * deliberately never called here: those return real Job objects, and this queue's jobId is
 * `${organizationId}:${eventName}:${entityId}` (see EventBusService.publish) — serializing a
 * raw job would leak tenant and entity identifiers. getJobCounts() alone cannot leak anything;
 * keep it that way.
 *
 * Connection lifecycle is deliberately per-call, not a field held for the service's lifetime:
 * HealthModule is wired into every NestApplication the process boots, but /health/queues is
 * called rarely — a connection opened once in the constructor would sit idle for the lifetime
 * of every single app instance (including the ~15 other e2e suites that never touch this
 * endpoint) for no benefit. Opening fresh, reading counts, and closing immediately keeps this
 * service's footprint at zero whenever it isn't actually being used.
 */
@Injectable()
export class QueueMetricsService {
  private readonly logger = new Logger(QueueMetricsService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Reads counts for both queues over one short-lived connection. Throws if either read fails
   * — a partial result would silently report a healthy-looking zero for a queue whose real
   * state is unknown, which is worse than surfacing the outage. The caller (HealthController)
   * is responsible for turning a thrown error into a redacted 503.
   */
  async getMetrics(): Promise<QueueMetrics> {
    const connection = new IORedis(
      this.configService.getOrThrow<string>('REDIS_URL'),
      { maxRetriesPerRequest: null },
    );
    const queues = QUEUE_NAMES.map((name) => new Queue(name, { connection }));
    try {
      const entries = await Promise.all(
        queues.map(async (queue) => {
          const counts = await queue.getJobCounts(
            'waiting',
            'active',
            'completed',
            'failed',
            'delayed',
            'paused',
          );
          const metrics: QueueCounts = {
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
            completed: counts.completed ?? 0,
            failed: counts.failed ?? 0,
            delayed: counts.delayed ?? 0,
            paused: counts.paused ?? 0,
          };
          return [queue.name, metrics] as const;
        }),
      );
      return Object.fromEntries(entries);
    } finally {
      await Promise.all(queues.map((queue) => queue.close())).catch(
        (error: unknown) =>
          this.logger.error('Failed to close queue metrics connection', error),
      );
      connection.disconnect();
    }
  }
}
