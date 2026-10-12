import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueueEvents } from 'bullmq';
import { ALL_QUEUE_NAMES } from '../core/queues/queue-registry';

/** Every queue this app runs — see core/queues/queue-registry.ts. This list used to be
 *  maintained by hand here and had silently fallen 4 queues behind reality. */
const QUEUE_NAMES = ALL_QUEUE_NAMES;

/**
 * Per-queue, per-process cooldown before the same alert can log again. This is a local
 * debounce only — it does not coordinate across API instances (see class doc below) — chosen
 * to keep a burst of failures (e.g. several jobs failing within the same minute) from producing
 * a log line per job. 5 minutes is long enough to collapse a burst into one line, short enough
 * that a genuinely ongoing outage keeps resurfacing in the logs rather than going silent.
 */
const ALERT_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Event-driven detection of definitively-failed BullMQ jobs on the 'events' and
 * 'payment-reconciliation' queues, surfaced as a generic server-side log line — the minimal
 * "someone should look at this" signal called for in docs/PRODUCTION_READINESS.md §19, without
 * building on the broader observability stack (structured logging, error tracking, /metrics)
 * that section also flags as missing. Deliberately separate from QueueMetricsService (Lot R):
 * that service is a stateless, ephemeral-per-call read (queue.getJobCounts()); this one is
 * fundamentally a long-lived subscription — BullMQ's QueueEvents keeps a dedicated Redis
 * connection open for its entire lifetime, continuously blocking on XREAD to receive the
 * queue's event stream (see bullmq's queue-events.js — "This class requires a dedicated redis
 * connection"). That's not a design choice made here; it's the only way QueueEvents can serve
 * its purpose, and it is NOT reused for the ephemeral get-metrics path — mixing the two
 * lifecycles into one service would make Lot R's already-audited connection behavior harder to
 * reason about for no benefit.
 *
 * A BullMQ 'failed' event only fires once a job has exhausted every attempt configured in Lot Q
 * (attempts:5) and BullMQ has moved it into the 'failed' set — an intermediate retry re-enters
 * 'active'/'delayed', never 'failed'. No extra attemptsMade/attempts bookkeeping is needed here
 * to make that distinction; it's inherent to which BullMQ event fires.
 *
 * Redaction: the 'failed' event's arguments (jobId, failedReason) are never read. On the
 * 'events' queue, jobId is `${organizationId}:${eventName}:${entityId}` (see
 * EventBusService.publish) — the only safe thing to log here is that *a* queue had *a* failure,
 * identified only by its fixed queue name, never anything the event itself carries.
 */
@Injectable()
export class QueueAlertingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueAlertingService.name);
  private readonly listeners: QueueEvents[] = [];
  private readonly lastAlertAt = new Map<string, number>();

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const url = this.configService.getOrThrow<string>('REDIS_URL');
    for (const queueName of QUEUE_NAMES) {
      this.startListening(queueName, url);
    }
  }

  /**
   * A failure initializing one queue's listener must never take the other down with it, and
   * must never fail NestJS startup — alerting is a secondary capability, never a boot
   * dependency (matching how EventBusService.publish() already treats a Redis failure as
   * something to log, never something to throw through to its caller).
   */
  private startListening(queueName: string, url: string): void {
    try {
      const queueEvents = new QueueEvents(queueName, { connection: { url } });
      // Attached synchronously, before any other await — QueueEvents starts its consuming loop
      // immediately (autorun defaults to true) and reports both its own connection errors and
      // any error surfacing from that loop by emitting 'error' on itself; an EventEmitter with
      // no 'error' listener throws on the next tick, which would otherwise crash the process on
      // a transient Redis hiccup at boot.
      queueEvents.on('error', (error) => {
        this.logger.error(
          `Queue alerting listener for "${queueName}" hit a connection error`,
          error,
        );
      });
      queueEvents.on('failed', () => {
        this.handleFailed(queueName);
      });
      this.listeners.push(queueEvents);
    } catch (error) {
      this.logger.error(
        `Failed to start the queue alerting listener for "${queueName}"`,
        error,
      );
    }
  }

  private handleFailed(queueName: string): void {
    const now = Date.now();
    const last = this.lastAlertAt.get(queueName) ?? 0;
    if (now - last < ALERT_COOLDOWN_MS) return;
    this.lastAlertAt.set(queueName, now);
    // Deliberately just the fixed queue name and a grep-able code — see class doc for why
    // nothing from the 'failed' event's own arguments is ever read or included here.
    this.logger.warn(
      `QUEUE_JOB_FAILED — queue "${queueName}" has a definitively failed job`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      this.listeners.map((queueEvents) =>
        queueEvents
          .close()
          .catch((error: unknown) =>
            this.logger.error(
              'Failed to close a queue alerting listener',
              error,
            ),
          ),
      ),
    );
  }
}
