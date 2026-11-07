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

  /** Set when an online payment the customer never completed was closed as failed after
   *  ONLINE_PAYMENT_ABANDON_HOURS — see PaymentsService.reconcileProcessingPayment. Such a
   *  payment is still revived if GeniusPay later reports it paid. */
  @Prop()
  abandonedAt?: Date;

  @Prop({ required: true })
  provider!: string;

  @Prop()
  providerReference?: string;

  /** Hosted checkout URL the payer must be redirected to — set only for a customer-initiated
   *  online payment (see PaymentProvider.createPayment's `checkoutUrl`), absent for a
   *  manually-recorded one. Read back by the storefront if it needs to re-show/re-send the
   *  same link (e.g. the customer navigated away before completing checkout). */
  @Prop()
  checkoutUrl?: string;

  @Prop()
  method?: string;

  /** The staff member who took the payment (counter QR or a payment recorded by hand), for the
   *  till report. Absent for a customer paying online on their own, and for payments recorded
   *  before 2026-11-01. */
  @Prop({ type: Types.ObjectId, ref: 'User' })
  recordedBy?: Types.ObjectId;

  /**
   * Gratuity collected alongside this payment — deliberately NOT folded into `amount` or
   * validated against the invoice's remaining balance (the tip isn't part of what's owed on the
   * invoice, it's extra money the customer chose to give). A restaurant-motivated addition, but
   * generic: any vertical taking a payment in person could record one.
   */
  @Prop({ min: 0 })
  tipAmount?: number;

  /** Optional attribution to the staff member who served the customer — same optional-Membership
   *  reference pattern as Resource.membershipId/Booking.staffMembershipId. */
  @Prop({ type: Types.ObjectId, ref: 'Membership' })
  tipStaffMembershipId?: Types.ObjectId;

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

// Stage 2.10 — supports PaymentsRepository.findProcessingPayments (existing, unindexed until
// now — used by PaymentReconciliationService's periodic sweep) and the new
// findProcessingPaymentsPaginated (ops observability) without a collection scan on a growing
// collection. Purely additive: no behavior change, no data change, no existing index removed.
// Mirrors the identical `{status:1, createdAt:-1}` index Stage 2.8 already added to
// RefundSchema for the exact same reason — see that schema's own comment on its own index.
// `status` alone (not folded into the organizationId+idempotencyKey index above, which only
// covers documents that HAVE a key) is what both queries filter on; `createdAt` covers their
// shared sort-by-recency.
PaymentSchema.index({ status: 1, createdAt: -1 });
