import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { SubscriptionInvoiceStatus } from '@korva/types';
import { idToJson } from '../../core/mongoose/schema-options';

export type SubscriptionInvoiceDocument = HydratedDocument<SubscriptionInvoice>;

/**
 * KORVA's own invoice to a tenant for one subscription period — see the `SubscriptionInvoice`
 * type in @korva/types for why this is a separate collection from finance's `Invoice` and never
 * reachable from any tenant finance/analytics query.
 */
@Schema({
  timestamps: true,
  collection: 'subscription_invoices',
  toJSON: idToJson,
})
export class SubscriptionInvoice {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Subscription', required: true })
  subscriptionId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Plan', required: true })
  planId!: Types.ObjectId;

  @Prop({ required: true })
  number!: string;

  @Prop({ type: String, default: 'open' })
  status!: SubscriptionInvoiceStatus;

  @Prop({ required: true })
  periodStart!: Date;

  @Prop({ required: true })
  periodEnd!: Date;

  @Prop({ required: true })
  amount!: number;

  @Prop({ required: true })
  currency!: string;

  @Prop({ required: true })
  issuedAt!: Date;

  @Prop({ required: true })
  dueAt!: Date;

  @Prop({ type: Date, default: null })
  paidAt!: Date | null;
}

export const SubscriptionInvoiceSchema =
  SchemaFactory.createForClass(SubscriptionInvoice);

/**
 * One invoice per (subscription, period start) — makes re-issuing for a period the scheduler
 * already billed physically impossible, so a sweep that crashes midway and runs again can never
 * double-bill. The scheduler relies on this: it treats a duplicate-key error as "already
 * issued", never as a failure.
 */
SubscriptionInvoiceSchema.index(
  { subscriptionId: 1, periodStart: 1 },
  { unique: true },
);

/** The scheduler's own lookup: the most recent invoice for a subscription, newest first. */
SubscriptionInvoiceSchema.index({ subscriptionId: 1, periodStart: -1 });
