import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import type { SystemEvent } from '@korva/types';
import { EVENTS_QUEUE_NAME, EventJobData } from './event-names';

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
    try {
      await this.queue.add(name, {
        organizationId,
        name,
        payload,
        occurredAt: new Date().toISOString(),
      });
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
