import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import {
  WebhookSubscription,
  WebhookSubscriptionSchema,
} from './schemas/webhook-subscription.schema';
import {
  WebhookDelivery,
  WebhookDeliverySchema,
} from './schemas/webhook-delivery.schema';

import { WebhookSubscriptionsRepository } from './webhook-subscriptions.repository';
import { WebhookDeliveriesRepository } from './webhook-deliveries.repository';
import { WebhookSubscriptionsService } from './webhook-subscriptions.service';
import { WebhookSubscriptionsController } from './webhook-subscriptions.controller';
import { WebhookDispatchService } from './webhook-dispatch.service';
import { WebhookDeliveryWorkerService } from './webhook-delivery-worker.service';

import { CredentialEncryptionModule } from '../shared/crypto/credential-encryption.module';
import { AuditModule } from '../audit/audit.module';

/**
 * A first-class "external partner subscribes to KORVA events" primitive (see
 * packages/types/src/webhook-subscriptions.ts) — distinct from the Workflow Engine's own
 * `webhook` action type, which lacks signing, retry/backoff, and a dedicated delivery log (see
 * docs/BUSINESS_OS_AUDIT.md §6). `WebhookDispatchService` is exported for EventsProcessor
 * (workflow.module.ts) to call on every event; it's the only piece another module needs.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WebhookSubscription.name, schema: WebhookSubscriptionSchema },
      { name: WebhookDelivery.name, schema: WebhookDeliverySchema },
    ]),
    CredentialEncryptionModule,
    AuditModule,
  ],
  controllers: [WebhookSubscriptionsController],
  providers: [
    WebhookSubscriptionsRepository,
    WebhookDeliveriesRepository,
    WebhookSubscriptionsService,
    WebhookDispatchService,
    WebhookDeliveryWorkerService,
  ],
  exports: [WebhookDispatchService],
})
export class WebhookSubscriptionsModule {}
