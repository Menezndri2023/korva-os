import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idToJson } from '../../../core/mongoose/schema-options';

export type CreditBalanceDocument = HydratedDocument<CreditBalance>;

/**
 * Generic prepaid-sessions tracker for a `package`-type Offer (e.g. a 10-session massage pass) —
 * not Salon-specific, any vertical selling session packs can reuse this identically. One row per
 * (organizationId, contactId, offerId): buying another pack tops up the same row rather than
 * creating a second one, so `totalCredits` always reflects lifetime purchases and
 * `remainingCredits` the live balance.
 */
@Schema({ timestamps: true, collection: 'credit_balances', toJSON: idToJson })
export class CreditBalance {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Contact', required: true, index: true })
  contactId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Offer', required: true })
  offerId!: Types.ObjectId;

  @Prop({ required: true, min: 0, default: 0 })
  totalCredits!: number;

  @Prop({ required: true, min: 0, default: 0 })
  remainingCredits!: number;
}

export const CreditBalanceSchema = SchemaFactory.createForClass(CreditBalance);
CreditBalanceSchema.index(
  { organizationId: 1, contactId: 1, offerId: 1 },
  { unique: true },
);
