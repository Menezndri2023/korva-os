import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import type { SystemEvent } from '@korva/types';
import { WebhookSubscriptionsRepository } from './webhook-subscriptions.repository';
import { WebhookDeliveriesRepository } from './webhook-deliveries.repository';
import {
  WEBHOOK_DELIVERY_QUEUE_NAME,
  WEBHOOK_DELIVERY_JOB_OPTIONS,
  WebhookDeliveryJobData,
} from './webhook-delivery.queue';

/**
 * Called from EventsProcessor on every event (see that file's third/fourth Promise.all entry) —
 * finds this organization's active subscriptions listening for this event and enqueues one
 * delivery job per match. Deliberately split from WebhookDeliveryWorker (which owns the same
 * queue's consuming side): this half must stay fast (find + enqueue only, never an actual HTTP
 * call) so it never makes the shared event pipeline wait on a slow or unreachable partner
 * endpoint — that's exactly what the queue hop is for.
 */
@Injectable()
export class WebhookDispatchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookDispatchService.name);
  private connection?: IORedis;
  private queue?: Queue<WebhookDeliveryJobData>;

  constructor(
    private readonly configService: ConfigService,
    private readonly subscriptionsRepository: WebhookSubscriptionsRepository,
    private readonly deliveriesRepository: WebhookDeliveriesRepository,
  ) {}

  onModuleInit(): void {
    this.connection = new IORedis(
      this.configService.getOrThrow<string>('REDIS_URL'),
      { maxRetriesPerRequest: null },
    );
    this.queue = new Queue<WebhookDeliveryJobData>(
      WEBHOOK_DELIVERY_QUEUE_NAME,
      {
        connection: this.connection,
      },
    );
    this.queue.on('error', (err) => {
      this.logger.error('Webhook delivery queue connection error', err);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
    this.connection?.disconnect();
  }

  /** `eventName` is `string` here (not `SystemEvent`), matching WorkflowEngineService/
   *  DecisionEngineService's own handleEvent signatures — EventJobData.name is plain string at
   *  this layer; every producer already only ever calls EventBusService.publish with a real
   *  SystemEvent, so this is never actually anything else in practice.
   *  Never throws — a dispatch failure must never abort the event it's reacting to, same
   *  philosophy as DecisionEngineService.handleEvent. */
  async dispatchEvent(
    organizationId: string,
    eventName: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this.queue) return;
    try {
      const subscriptions =
        await this.subscriptionsRepository.findActiveForEvent(
          organizationId,
          eventName,
        );
      for (const subscription of subscriptions) {
        const delivery = await this.deliveriesRepository.create({
          organizationId: subscription.organizationId,
          subscriptionId: subscription._id,
          eventName: eventName as SystemEvent,
          payload,
          status: 'pending',
        });
        await this.queue.add(
          'deliver',
          {
            deliveryId: delivery.id as string,
            subscriptionId: subscription.id as string,
            eventName: eventName as SystemEvent,
            payload,
          },
          WEBHOOK_DELIVERY_JOB_OPTIONS,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to dispatch event "${eventName}" to webhook subscriptions`,
        error,
      );
    }
  }
}
