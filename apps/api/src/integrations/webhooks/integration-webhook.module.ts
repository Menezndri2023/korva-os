import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  IntegrationWebhookEvent,
  IntegrationWebhookEventSchema,
} from './schemas/integration-webhook-event.schema';
import { IntegrationWebhookRepository } from './integration-webhook.repository';
import { IntegrationWebhookService } from './integration-webhook.service';

/**
 * Stage 1 (FOUND-WEBHOOK) foundation module: schema + repository + the generic
 * verify → idempotency-check → publish pipeline (IntegrationWebhookService). No controller is
 * registered here — there is no real Flutterwave/360dialog webhook route to receive yet (Stage 2,
 * see docs/architecture/integrations-platform.md §8); this module's tests exercise
 * IntegrationWebhookService directly through NestJS's testing module, not over HTTP.
 *
 * Deliberately NOT imported into AppModule — the Wave 4 orchestrator wires that in once Stage 2
 * adapters exist to actually call into this pipeline. EventBusService (injected by
 * IntegrationWebhookService) is provided globally by core/events/events.module.ts once that
 * wiring happens, so this module doesn't need to import EventsModule itself, matching every other
 * EventBusService consumer in this codebase (e.g. PaymentsService, OrdersService).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: IntegrationWebhookEvent.name,
        schema: IntegrationWebhookEventSchema,
      },
    ]),
  ],
  providers: [IntegrationWebhookRepository, IntegrationWebhookService],
  exports: [IntegrationWebhookRepository, IntegrationWebhookService],
})
export class IntegrationWebhookModule {}
