import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { CustomFieldValues, OfferStatus, OfferType } from '@korva/types';
import { OFFER_STATUSES, OFFER_TYPES } from '@korva/types';

export type OfferDocument = HydratedDocument<Offer>;

@Schema({ _id: false })
export class OfferPricing {
  @Prop({ required: true })
  amount!: number;

  @Prop({ required: true })
  currency!: string;

  @Prop()
  taxRate?: number;
}
export const OfferPricingSchema = SchemaFactory.createForClass(OfferPricing);

@Schema({ _id: true })
export class OfferVariant {
  @Prop({ required: true })
  name!: string;

  @Prop()
  sku?: string;

  @Prop()
  priceOverride?: number;
}
export const OfferVariantSchema = SchemaFactory.createForClass(OfferVariant);

@Schema({
  timestamps: true,
  collection: 'offers',
  toJSON: {
    virtuals: true,
    transform: (_doc, ret: Record<string, unknown>) => {
      ret.id = String(ret._id);
      delete ret._id;
      delete ret.__v;
      if (Array.isArray(ret.variants)) {
        ret.variants = (ret.variants as Record<string, unknown>[]).map(
          (variant) => {
            const { _id, ...rest } = variant;
            return { id: String(_id), ...rest };
          },
        );
      }
      return ret;
    },
  },
})
export class Offer {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: String, enum: OFFER_TYPES, required: true })
  type!: OfferType;

  @Prop({ required: true })
  name!: string;

  @Prop()
  description?: string;

  @Prop({ type: [String], default: [] })
  images!: string[];

  @Prop({ type: [String], default: [] })
  categories!: string[];

  @Prop({ type: OfferPricingSchema, required: true })
  pricing!: OfferPricing;

  @Prop()
  sku?: string;

  @Prop({ type: [OfferVariantSchema], default: [] })
  variants!: OfferVariant[];

  @Prop({ type: String, enum: OFFER_STATUSES, default: 'draft' })
  status!: OfferStatus;

  @Prop({ type: Object, default: {} })
  customFields!: CustomFieldValues;

  /** See Offer.trackStock/stockOnHand in @korva/types for the field-level rationale. */
  @Prop({ default: false })
  trackStock!: boolean;

  @Prop({ min: 0 })
  stockOnHand?: number;
}

export const OfferSchema = SchemaFactory.createForClass(Offer);
OfferSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
OfferSchema.index({ organizationId: 1, type: 1 });
OfferSchema.index({ organizationId: 1, categories: 1 });
OfferSchema.index({ organizationId: 1, sku: 1 });
OfferSchema.index({
  organizationId: 1,
  name: 'text',
  description: 'text',
  sku: 'text',
});
