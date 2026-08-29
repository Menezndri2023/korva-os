import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
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

  /**
   * Stage 2.5 — the tenant this webhook was attributed to, resolved server-side from a verified
   * provider-account identity (Flutterwave: `tx_ref` → the KORVA-created Payment's own
   * organizationId; 360dialog: WABA id → the connected tenant IntegrationAccount's
   * organizationId) BEFORE this document is written — NEVER copied from anything the payload
   * itself claims to be an organization (see docs/architecture/integrations-platform.md §8
   * addendum). `null` means the signature was valid but no tenant could be resolved (unknown
   * provider account, or a payload shape with no identifiable reference) — an explicit, queryable
   * "unresolved" state, not a missing/legacy field. Documents created before Stage 2.5 simply
   * don't have this field at all, which reads back identically to `null` on a `find()` — no
   * backfill migration needed (see this stage's final report §7 for why a backfill is explicitly
   * out of scope here).
   */
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    default: null,
    index: true,
  })
  organizationId!: Types.ObjectId | null;
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

// Stage 2.8 — supports IntegrationWebhookRepository.findUnresolvedEvents' own query+sort
// (`{organizationId: null, ...filters}`, sorted by receivedAt desc for deterministic pagination)
// without a collection scan. Purely additive: no behavior change, no data change — the existing
// single-field index on `organizationId` (see that field's own @Prop above) already made the
// equality filter itself indexable; this compound index additionally covers the sort. Also
// serves the identical query shape scoped to a specific tenant (organizationId != null), which
// is why `domain` isn't folded into this index — provider/domain filtering on what is already a
// small, operator-facing result set doesn't need its own index.
IntegrationWebhookEventSchema.index({ organizationId: 1, receivedAt: -1 });
