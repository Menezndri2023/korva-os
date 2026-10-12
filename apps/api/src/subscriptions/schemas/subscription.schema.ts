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
   * Still never billed, but no longer for want of a PSP: SubscriptionInvoice bills the plan's
   * full `priceAmount` for the period and ignores this field entirely (see
   * SubscriptionPeriodSchedulerService.resolveRenewal). Applying it means deciding whether a
   * mid-period upgrade is invoiced immediately or folded into the next period's amount — a
   * pricing decision, not a missing integration.
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
