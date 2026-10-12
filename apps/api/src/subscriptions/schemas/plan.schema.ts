import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type { KorvaModule } from '@korva/types';
import type { PlanInterval } from '@korva/types';
import { idToJson } from '../../core/mongoose/schema-options';

export type PlanDocument = HydratedDocument<Plan>;

@Schema({ timestamps: true, collection: 'plans', toJSON: idToJson })
export class Plan {
  @Prop({ required: true })
  key!: string;

  @Prop({ required: true })
  name!: string;

  @Prop({ required: true })
  priceAmount!: number;

  @Prop({ required: true })
  priceCurrency!: string;

  @Prop({ type: String, required: true })
  interval!: PlanInterval;

  @Prop({ type: [String], default: [] })
  modules!: KorvaModule[];

  @Prop({ type: Object, default: {} })
  limits!: Record<string, number>;
}

export const PlanSchema = SchemaFactory.createForClass(Plan);

/**
 * One plan document per (tier, currency) — `key` alone was unique until 2026-10-12, which made
 * a single global price list the only possible shape.
 *
 * A tier priced in two currencies is two documents, and a Subscription points at exactly one of
 * them, so a subscription is bound to the currency it was sold in. That is deliberate: silently
 * re-denominating someone's subscription because their organization's currency changed would
 * rewrite what they agreed to pay.
 *
 * A tier simply not priced in a currency is not offered in that currency. PlansService.list
 * filters by the organization's own currency, so "we have not set a price here yet" and "this
 * tier does not exist" look identical to the tenant — which is the correct behavior: you only
 * sell where you have decided on a price.
 */
PlanSchema.index({ key: 1, priceCurrency: 1 }, { unique: true });
