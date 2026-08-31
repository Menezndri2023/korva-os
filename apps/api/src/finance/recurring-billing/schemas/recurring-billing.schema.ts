import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type {
  RecurringBillingInterval,
  RecurringBillingStatus,
} from '@korva/types';
import {
  RECURRING_BILLING_INTERVALS,
  RECURRING_BILLING_STATUSES,
} from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';

export type RecurringBillingDocument = HydratedDocument<RecurringBilling>;

/**
 * A business's own recurring billing plan for one of its customers (e.g. a monthly retainer) —
 * see the matching doc comment on the RecurringBilling type in @korva/types for why this is
 * deliberately not named/conflated with the platform's own `Subscription` (KORVA's SaaS billing
 * for the organization itself, apps/api/src/subscriptions/).
 */
@Schema({
  timestamps: true,
  collection: 'recurring_billings',
  toJSON: idToJson,
})
export class RecurringBilling {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Contact', required: true })
  contactId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Offer', required: true })
  offerId!: Types.ObjectId;

  @Prop({ type: String, enum: RECURRING_BILLING_INTERVALS, required: true })
  interval!: RecurringBillingInterval;

  @Prop({ type: String, enum: RECURRING_BILLING_STATUSES, default: 'active' })
  status!: RecurringBillingStatus;

  /** Snapshotted from the offer's pricing at creation time — see the @korva/types doc comment. */
  @Prop({ required: true })
  amount!: number;

  @Prop({ required: true })
  currency!: string;

  @Prop({ required: true, index: true })
  nextBillingDate!: Date;

  @Prop({ type: Types.ObjectId, ref: 'Invoice' })
  lastInvoiceId?: Types.ObjectId;

  @Prop()
  cancelledAt?: Date;
}

export const RecurringBillingSchema =
  SchemaFactory.createForClass(RecurringBilling);
RecurringBillingSchema.index({
  organizationId: 1,
  status: 1,
  nextBillingDate: 1,
});
// Supports the scheduler's global (org-agnostic) sweep query — same pattern already indexed on
// Quote/Invoice/Payment/Refund for the identical class of query (see quote.schema.ts's own
// matching comment).
RecurringBillingSchema.index({ status: 1, nextBillingDate: 1 });
