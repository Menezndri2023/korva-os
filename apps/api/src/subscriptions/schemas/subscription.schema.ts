import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { KorvaProduct, SubscriptionStatus } from '@korva/types';
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
   * means owed, negative means a credit.
   *
   * Billed by being folded into the NEXT SubscriptionInvoice's amount, then cleared, so it is
   * charged exactly once (SubscriptionPeriodSchedulerService.resolveRenewal +
   * SubscriptionsRepository.clearAppliedProration). Invoiced with the next period rather than
   * immediately because there is no card on file: a separate mid-period invoice would mean
   * sending the tenant another payment link for what is often a few units of currency.
   *
   * A credit larger than the period's price is clamped at zero — never a negative invoice — and
   * the unapplied remainder is recorded in the audit entry rather than carried forward, which
   * would need a credit-balance concept this codebase does not have.
   */
  @Prop({ type: Number, default: null })
  prorationAmount!: number | null;

  @Prop({ type: String, default: null })
  prorationCurrency!: string | null;

  @Prop({ type: Date, default: null })
  prorationCalculatedAt!: Date | null;

  /**
   * Independent of the plan's own module list — see resolveEffectiveModules in @korva/types.
   * No `default` on purpose: unlike an array Prop (which Mongoose auto-defaults to `[]` — see
   * the Mongoose array-default gotcha this codebase has hit before), a plain Object/Mixed path
   * genuinely stays `undefined` for a document that never sets it, which is what we want here
   * (undefined means "zero overrides, pure plan-driven entitlement, today's exact behavior").
   */
  @Prop({ type: Object })
  productOverrides?: Partial<Record<KorvaProduct, boolean>>;
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);
