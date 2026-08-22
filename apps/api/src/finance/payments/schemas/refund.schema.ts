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
