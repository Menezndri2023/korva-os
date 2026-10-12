import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { WebhookSubscriptionsRepository } from './webhook-subscriptions.repository';
import { WebhookDeliveriesRepository } from './webhook-deliveries.repository';
import { CredentialEncryptionService } from '../shared/crypto/credential-encryption.service';
import { safeFetch } from '../shared/safe-fetch';
import { backgroundWorkersDisabled } from '../core/background/background-workers';
import {
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  signPayload,
} from './webhook-signature.util';
import {
  WEBHOOK_DELIVERY_QUEUE_NAME,
  WebhookDeliveryJobData,
} from './webhook-delivery.queue';

/**
 * Consumes the `webhook-deliveries` queue WebhookDispatchService enqueues into — the two are
 * deliberately split so a slow/unreachable partner endpoint can never make the shared event
 * pipeline (EventsProcessor) wait; see WebhookDispatchService's own doc. Every delivery is signed
 * (X-Korva-Signature, HMAC-SHA256 over the raw body with the subscription's own secret — see
 * webhook-signature.util.ts) so a receiver can verify it genuinely came from KORVA, closing the
 * signing gap the Workflow Engine's own `webhook` action has.
 */
@Injectable()
export class WebhookDeliveryWorkerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WebhookDeliveryWorkerService.name);
  private connection?: IORedis;
  private worker?: Worker<WebhookDeliveryJobData>;

  constructor(
    private readonly configService: ConfigService,
    private readonly subscriptionsRepository: WebhookSubscriptionsRepository,
    private readonly deliveriesRepository: WebhookDeliveriesRepository,
    private readonly credentialEncryptionService: CredentialEncryptionService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Unlike the schedulers, this worker has no interval and no per-feature flag — it
    // consumed unconditionally, including inside a CLI script's application context. See
    // core/background/background-workers.ts.
    if (backgroundWorkersDisabled(this.configService)) {
      this.logger.log(
        'WebhookDeliveryWorkerService disabled (DISABLE_BACKGROUND_WORKERS)',
      );
      return;
    }
    this.connection = new IORedis(
      this.configService.getOrThrow<string>('REDIS_URL'),
      { maxRetriesPerRequest: null },
    );
    this.worker = new Worker<WebhookDeliveryJobData>(
      WEBHOOK_DELIVERY_QUEUE_NAME,
      async (job) => this.deliver(job),
      { connection: this.connection },
    );
    // Purely synchronous logging here, unlike EventsProcessor's own 'failed' handler — this
    // worker already records the terminal 'failed' outcome to WebhookDelivery/WebhookSubscription
    // itself, from inside deliver(), the moment it knows this was the last attempt (see that
    // method) — doing it here too, async, would both duplicate the write and force this listener
    // to be async for no benefit.
    this.worker.on('failed', (job, error) => {
      const attemptsMade = job?.attemptsMade ?? 0;
      const attempts = job?.opts.attempts ?? 1;
      const exhausted = attemptsMade >= attempts;
      this.logger.error(
        `Webhook delivery job ${job?.id} failed on attempt ${attemptsMade}/${attempts}` +
          (exhausted ? ' — attempts exhausted' : ' — will retry'),
        error,
      );
    });
    this.worker.on('error', (err) => {
      this.logger.error('Webhook delivery queue worker connection error', err);
    });
    await this.worker.waitUntilReady();
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    this.connection?.disconnect();
  }

  private async deliver(job: Job<WebhookDeliveryJobData>): Promise<void> {
    const data = job.data;
    const attemptNumber = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? 1;
    const isFinalAttempt = attemptNumber >= maxAttempts;

    await this.deliveriesRepository.update(data.deliveryId, {
      attempts: attemptNumber,
    });

    const subscription = await this.subscriptionsRepository.findByIdWithSecret(
      data.subscriptionId,
    );
    if (!subscription || !subscription.active) {
      // The subscription was deleted/deactivated after this delivery was enqueued — retrying
      // can never succeed, so this is a terminal failure without throwing (no retry wanted),
      // regardless of how many attempts remain.
      await this.deliveriesRepository.update(data.deliveryId, {
        status: 'failed',
        error: 'Subscription no longer active',
      });
      await this.subscriptionsRepository.recordDeliveryOutcome(
        data.subscriptionId,
        'failed',
      );
      return;
    }

    const secret = this.credentialEncryptionService.decrypt(
      subscription.secretEncrypted,
    );
    const rawBody = JSON.stringify({
      event: data.eventName,
      data: data.payload,
    });
    const signature = signPayload(secret, rawBody);

    let response: Response;
    try {
      response = await safeFetch(subscription.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [WEBHOOK_SIGNATURE_HEADER]: signature,
          [WEBHOOK_EVENT_HEADER]: data.eventName,
        },
        body: rawBody,
      });
    } catch (error) {
      await this.recordAttemptFailure(
        data,
        isFinalAttempt,
        undefined,
        error instanceof Error ? error.message : 'Unknown delivery error',
      );
      throw error; // let BullMQ retry, unless this was already the final attempt
    }

    if (!response.ok) {
      await this.recordAttemptFailure(
        data,
        isFinalAttempt,
        response.status,
        `Endpoint responded with status ${response.status}`,
      );
      throw new Error(`Webhook delivery failed with status ${response.status}`);
    }

    await this.deliveriesRepository.update(data.deliveryId, {
      status: 'success',
      responseStatus: response.status,
    });
    await this.subscriptionsRepository.recordDeliveryOutcome(
      data.subscriptionId,
      'success',
    );
  }

  /**
   * Writes the delivery log's terminal 'failed' status from INSIDE the job handler, the instant
   * it knows this attempt is the last one BullMQ will make — rather than from the Worker's
   * 'failed' event listener, which would have to be async to do the same writes (BullMQ expects
   * a void-returning 'failed' listener; see onModuleInit's own comment).
   */
  private async recordAttemptFailure(
    data: WebhookDeliveryJobData,
    isFinalAttempt: boolean,
    responseStatus: number | undefined,
    error: string,
  ): Promise<void> {
    await this.deliveriesRepository.update(data.deliveryId, {
      ...(responseStatus !== undefined ? { responseStatus } : {}),
      error,
      ...(isFinalAttempt ? { status: 'failed' as const } : {}),
    });
    if (isFinalAttempt) {
      await this.subscriptionsRepository.recordDeliveryOutcome(
        data.subscriptionId,
        'failed',
      );
    }
  }
}
