import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { DiscountCodeScope, DiscountCodeType } from '@korva/types';
import { DISCOUNT_CODE_SCOPES, DISCOUNT_CODE_TYPES } from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';

export type DiscountCodeDocument = HydratedDocument<DiscountCode>;

@Schema({ timestamps: true, collection: 'discount_codes', toJSON: idToJson })
export class DiscountCode {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  /** Normalized uppercase at write time — see DiscountCodesService.create/normalizeCode. */
  @Prop({ required: true })
  code!: string;

  @Prop({ type: String, enum: DISCOUNT_CODE_TYPES, required: true })
  type!: DiscountCodeType;

  @Prop({ required: true })
  value!: number;

  @Prop()
  currency?: string;

  @Prop()
  startsAt?: Date;

  @Prop()
  expiresAt?: Date;

  @Prop()
  maxRedemptions?: number;

  @Prop({ default: 0 })
  redemptionsCount!: number;

  @Prop({ type: String, enum: DISCOUNT_CODE_SCOPES, default: 'all' })
  scope!: DiscountCodeScope;

  @Prop({ type: [Types.ObjectId], ref: 'Offer', default: [] })
  offerIds!: Types.ObjectId[];

  @Prop({ default: true })
  active!: boolean;
}

export const DiscountCodeSchema = SchemaFactory.createForClass(DiscountCode);
DiscountCodeSchema.index({ organizationId: 1, code: 1 }, { unique: true });
DiscountCodeSchema.index({ organizationId: 1, active: 1 });
