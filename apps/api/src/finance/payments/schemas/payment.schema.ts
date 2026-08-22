import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { PaymentStatus } from '@korva/types';
import { PAYMENT_STATUSES } from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';

export type PaymentDocument = HydratedDocument<Payment>;

@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'payments',
  toJSON: idToJson,
})
export class Payment {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Invoice', required: true, index: true })
  invoiceId!: Types.ObjectId;

  @Prop({ required: true })
  amount!: number;

  @Prop({ required: true })
  currency!: string;

  @Prop({ type: String, enum: PAYMENT_STATUSES, default: 'pending' })
  status!: PaymentStatus;

  @Prop({ required: true })
  provider!: string;

  @Prop()
  providerReference?: string;

  @Prop()
  method?: string;

  /**
   * Denormalized running total of refunds accepted against this payment — exists solely so
   * PaymentsRepository.incrementRefundedAmountWithinLimit can enforce
   * `refundedAmount + delta <= amount` atomically in a single MongoDB write, the same pattern
   * Invoice.amountPaid already uses against `total`. Documents created before this field
   * existed simply don't have it; that read path always goes through `$ifNull` in the atomic
   * update, so no backfill migration is needed. `sumRefundsForPayment` (aggregating the actual
   * Refund documents) remains the source of truth for display/reporting.
   */
  @Prop({ default: 0 })
  refundedAmount!: number;

  /**
   * Client-supplied via the `Idempotency-Key` HTTP header (never a body field — see
   * PaymentsController.create) — absent entirely for callers that don't send the header
   * (legacy behavior, unaffected). Doubles as both the claim record AND the request
   * fingerprint: PaymentsService.create() first inserts a Payment with status 'processing'
   * and this key set, BEFORE calling the provider, so the unique index below is what actually
   * arbitrates two concurrent requests racing on the same key — only one insert can win.
   */
  @Prop()
  idempotencyKey?: string;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);
PaymentSchema.index({ organizationId: 1, invoiceId: 1 });
// Optional field — most Payments (created without an Idempotency-Key) never set it, so this
// must be a partial index or every keyless Payment would collide on a shared missing value.
// Scoped by organizationId (not global) per the idempotency design: a key only has meaning
// within the organization that issued it.
PaymentSchema.index(
  { organizationId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $exists: true } },
  },
);
