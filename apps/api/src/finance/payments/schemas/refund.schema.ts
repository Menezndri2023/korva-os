import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idToJson } from '../../../core/mongoose/schema-options';

export type RefundDocument = HydratedDocument<Refund>;

@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'refunds',
  toJSON: idToJson,
})
export class Refund {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Payment', required: true, index: true })
  paymentId!: Types.ObjectId;

  @Prop({ required: true })
  amount!: number;

  @Prop()
  reason?: string;

  /**
   * Absent for every Refund created by the legacy (non-idempotent) flow — a Refund has always
   * represented an already-successful event purely by existing, with no in-between state. Only
   * set when PaymentsService.refund() is called with an Idempotency-Key: 'processing' the
   * instant the claim is inserted (before the provider call), then flipped to 'completed'
   * inside the same transaction as the Payment/Invoice writes, or to 'failed' outside it if the
   * provider call itself throws. sumRefundsForPayment() excludes 'processing'/'failed' rows —
   * only a legacy row (no status) or a 'completed' one represents a real, confirmed refund.
   */
  @Prop({ type: String, enum: ['processing', 'completed', 'failed'] })
  status?: 'processing' | 'completed' | 'failed';

  /**
   * Client-supplied via the `Idempotency-Key` HTTP header (never a body field — see
   * PaymentsController.refund), mirroring Payment.idempotencyKey. Doubles as both the claim
   * record and the request fingerprint.
   */
  @Prop()
  idempotencyKey?: string;

  /** Online payment through a provider with no refund API (GeniusPay): the amount is taken off
   *  the business's Solde at once, and KORVA's administration sends it back to the customer by
   *  hand, then records `manualReference` — see PaymentsService.completeManualRefund. */
  @Prop()
  manual?: boolean;

  @Prop()
  manualReference?: string;

  @Prop()
  manualRejectionReason?: string;

  /**
   * The provider's own reference for this refund — previously never captured at all (the
   * legacy flow discarded PaymentProvider.refundPayment()'s return value entirely). Persisted
   * as soon as the provider call resolves, before the Mongo transaction that finalizes this
   * Refund, so PaymentReconciliationService has something to query if the process crashes in
   * between. Without this, a Refund stuck in 'processing' can never be reconciled — there is
   * nothing to ask the provider about.
   */
  @Prop()
  providerReference?: string;

  /**
   * Stage 2.12 — a genuinely REFUND-specific provider identifier (e.g. Flutterwave's own numeric
   * refund `id`), distinct from `providerReference` above (which is always the underlying
   * Payment's own merchant reference/tx_ref, never a refund-specific value — see
   * FlutterwaveProvider.refundPayment's own doc comment). Optional: only ever populated when the
   * provider's refund-creation response actually contains it — never fabricated, never required.
   * Legacy Refunds (created before this stage, or via ManualPaymentProvider) simply never set it.
   */
  @Prop()
  providerRefundId?: string;

  /**
   * Stage 2.12 — Flutterwave's own `flw_ref`-style refund reference, if the response actually
   * contains one. Same rules as `providerRefundId`: optional, only ever populated when present,
   * never fabricated. Kept as a SEPARATE field from `providerRefundId` because Flutterwave's own
   * documented refund-listing schema treats `id` and `flw_ref` as two distinct fields on the same
   * refund record — collapsing them into one field would destroy that distinction for no reason.
   */
  @Prop()
  providerRefundReference?: string;
}

export const RefundSchema = SchemaFactory.createForClass(Refund);
// Optional field — most Refunds (created without an Idempotency-Key) never set it, so this
// must be a partial index or every keyless Refund would collide on a shared missing value.
// Scoped by organizationId, mirroring Payment's idempotency index.
RefundSchema.index(
  { organizationId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $exists: true } },
  },
);

// Stage 2.8 — supports PaymentsRepository.findProcessingRefunds (existing, unindexed until now)
// and the new findRefundsRequiringAttention (ops observability) without a collection scan on a
// growing collection. Purely additive: no behavior change, no data change. `status` alone (not
// bundled into the organizationId+idempotencyKey index above, which only covers documents that
// HAVE a key) is what both queries filter on; `createdAt` covers their shared sort-by-recency.
RefundSchema.index({ status: 1, createdAt: -1 });
