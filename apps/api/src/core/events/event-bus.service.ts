import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import type { SystemEvent } from '@korva/types';
import {
  EVENT_ENTITY_ID_FIELD,
  EVENTS_QUEUE_NAME,
  EventJobData,
} from './event-names';

/**
 * Every retry needs its own delay slot, not a fixed 2s no matter which attempt this is —
 * exponential backoff so a real outage (Redis flapping, a downstream Mongo blip) gets
 * increasingly more room before hammering it again, while a one-off transient error still
 * retries fast. 5 attempts × exponential-from-2s tops out around ~30s total spread, short
 * enough that a job isn't stuck "in flight" for minutes while still absorbing brief blips.
 */
const JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
  // Keep failed jobs indefinitely (default BullMQ behavior) — the 'failed' set is the only DLQ
  // this system has; removing them would silently destroy the one trace of a permanently lost
  // event. Completed jobs are pruned since they carry no diagnostic value once done.
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: false,
} as const;

/**
 * Every important business action publishes an event here instead of calling
 * downstream logic (workflows, future notifications, ...) directly. Publishing
 * only pushes a job onto a Redis-backed queue — it never runs the actual
 * workflow evaluation inline, so a slow or failing consumer can never block
 * the HTTP request that triggered the event (see docs/architecture.md, Event Bus).
 */
@Injectable()
export class EventBusService implements OnModuleDestroy {
  private readonly logger = new Logger(EventBusService.name);
  private readonly connection: IORedis;
  private readonly queue: Queue<EventJobData>;

  constructor(configService: ConfigService) {
    this.connection = new IORedis(
      configService.getOrThrow<string>('REDIS_URL'),
      {
        maxRetriesPerRequest: null,
      },
    );
    this.queue = new Queue<EventJobData>(EVENTS_QUEUE_NAME, {
      connection: this.connection,
    });
  }

  async publish(
    organizationId: string,
    name: SystemEvent,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const entityId = payload[EVENT_ENTITY_ID_FIELD[name]];
    const eventKey =
      typeof entityId === 'string' && entityId.length > 0
        ? `${name}:${entityId}`
        : undefined;

    try {
      await this.queue.add(
        name,
        {
          organizationId,
          name,
          payload,
          occurredAt: new Date().toISOString(),
          eventKey,
        },
        {
          ...JOB_OPTIONS,
          // Only set when eventKey is derivable — BullMQ silently drops a second add() with an
          // id that already exists, which is exactly what dedupes two publish() calls for the
          // same logical event before they ever become two separate jobs. Without a reliable
          // entity id there's nothing safe to dedupe on, so we fall back to BullMQ's default
          // auto-generated id (no enqueue-time dedup for that event, same as today).
          ...(eventKey ? { jobId: `${organizationId}:${eventKey}` } : {}),
        },
      );
    } catch (error) {
      // A queueing failure must never break the business operation that emitted the event.
      this.logger.error(`Failed to publish event "${name}"`, error);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
