import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { idToJson } from '../../../core/mongoose/schema-options';

export const INTEGRATION_WEBHOOK_EVENT_DOMAINS = [
  'payment',
  'messaging',
] as const;
export type IntegrationWebhookEventDomain =
  (typeof INTEGRATION_WEBHOOK_EVENT_DOMAINS)[number];

export type IntegrationWebhookEventDocument =
  HydratedDocument<IntegrationWebhookEvent>;

/**
 * Audit/replay trail AND the actual idempotency mechanism for the generic webhook ingestion
 * pipeline (see docs/architecture/integrations-platform.md §6, integration-webhook.service.ts).
 * One row per distinct delivery a provider makes; the unique index below on
 * (provider, providerEventId) — not a timestamp heuristic, not a read-then-write check — is what
 * guarantees a duplicate/redelivered webhook can never be persisted (or published as a domain
 * event) twice. Mirrors the (organizationId, idempotencyKey) unique index style already used by
 * PaymentSchema (see payment.schema.ts) and the Resend `email_id` dedup this generalizes.
 */
@Schema({
  timestamps: false,
  collection: 'integration_webhook_events',
  toJSON: idToJson,
})
export class IntegrationWebhookEvent {
  /** e.g. 'flutterwave', '360dialog' — never 'resend' (that pipeline stays separate, see §6). */
  @Prop({ required: true })
  provider!: string;

  /**
   * The provider's own event/delivery id, exactly as it names it (Flutterwave's `data.id`,
   * 360dialog's own message/status id, ...) — extracted by the caller
   * (IntegrationWebhookService.process's `extractEventId`) before this document is written.
   */
  @Prop({ required: true })
  providerEventId!: string;

  @Prop({
    type: String,
    enum: INTEGRATION_WEBHOOK_EVENT_DOMAINS,
    required: true,
  })
  domain!: IntegrationWebhookEventDomain;

  /** Raw, already-signature-verified payload, kept verbatim for audit/replay — never logged. */
  @Prop({ type: Object, required: true })
  payload!: Record<string, unknown>;

  @Prop({ type: Date, required: true })
  receivedAt!: Date;
}

export const IntegrationWebhookEventSchema = SchemaFactory.createForClass(
  IntegrationWebhookEvent,
);

// The actual idempotency mechanism (see integration-webhook.repository.ts) — a duplicate
// (provider, providerEventId) delivery can never insert a second document, enforced by MongoDB
// itself via this unique index, not by an application-level read-then-write.
IntegrationWebhookEventSchema.index(
  { provider: 1, providerEventId: 1 },
  { unique: true },
);
