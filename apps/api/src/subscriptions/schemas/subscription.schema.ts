import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { SubscriptionStatus } from '@korva/types';
import { idToJson } from '../../core/mongoose/schema-options';

export type SubscriptionDocument = HydratedDocument<Subscription>;

@Schema({ timestamps: true, collection: 'subscriptions', toJSON: idToJson })
export class Subscription {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    unique: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Plan', required: true })
  planId!: Types.ObjectId;

  @Prop({ type: String, default: 'active' })
  status!: SubscriptionStatus;

  @Prop({ required: true })
  currentPeriodStart!: Date;

  @Prop({ required: true })
  currentPeriodEnd!: Date;

  /** Whether the subscription is scheduled to become 'canceled' once currentPeriodEnd is reached. */
  @Prop({ type: Boolean, default: false })
  cancelAtPeriodEnd!: boolean;

  /** When cancelAtPeriodEnd was last set to true (a cancel-at-period-end request). */
  @Prop({ type: Date, default: null })
  cancelRequestedAt!: Date | null;

  /** When status actually became 'canceled' (immediate cancel, or the period scheduler). */
  @Prop({ type: Date, default: null })
  canceledAt!: Date | null;

  /**
   * Computed, stored-only proration from the most recent mid-period changePlan() — positive
   * means owed, negative means a credit. Never actually charged: no PSP integration exists yet.
   */
  @Prop({ type: Number, default: null })
  prorationAmount!: number | null;

  @Prop({ type: String, default: null })
  prorationCurrency!: string | null;

  @Prop({ type: Date, default: null })
  prorationCalculatedAt!: Date | null;
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);
