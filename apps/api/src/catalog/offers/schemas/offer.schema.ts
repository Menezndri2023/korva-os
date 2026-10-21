import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type {
  CustomFieldValues,
  OfferOptionGroup,
  OfferStatus,
  OfferType,
} from '@korva/types';
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

  /** EAN/UPC — distinct from `sku` (an internal reference), a variant's own retail barcode. */
  @Prop()
  barcode?: string;

  @Prop()
  priceOverride?: number;

  /** See OfferVariant.stockOnHand in @korva/types for the field-level rationale. */
  @Prop({ min: 0 })
  stockOnHand?: number;
}
export const OfferVariantSchema = SchemaFactory.createForClass(OfferVariant);

@Schema({ _id: false })
export class BundleItem {
  @Prop({ type: Types.ObjectId, ref: 'Offer', required: true })
  offerId!: Types.ObjectId;

  @Prop({ required: true, min: 1 })
  quantity!: number;
}
export const BundleItemSchema = SchemaFactory.createForClass(BundleItem);

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

  /** EAN/UPC for offers with no variants — see OfferVariant.barcode for the per-variant version. */
  @Prop()
  barcode?: string;

  /** Free-form key-value product attributes (e.g. {"couleur":"rouge","taille":"M"}) — distinct
   *  from `customFields`, which is org-defined and validated against a CustomField schema;
   *  attributes are unvalidated, ad-hoc descriptors an offer can carry without any setup. */
  @Prop({ type: Object, default: undefined })
  attributes?: Record<string, string>;

  /** A bundle/kit is a real Offer in its own right (it has its own price/status/images) that also
   *  lists the offers it's composed of, purely descriptive — no cascading stock deduction from a
   *  bundle sale onto its component offers exists yet (out of scope for this pass; see
   *  docs/KORVA_OS_V2_AUDIT.md §2.4's own "additive fields" framing for C1). */
  @Prop({ default: false })
  isBundle!: boolean;

  @Prop({ type: [BundleItemSchema], default: undefined })
  bundleItems?: BundleItem[];

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

  /** See Offer.lowStockThreshold in @korva/types for the field-level rationale. */
  @Prop({ min: 0 })
  lowStockThreshold?: number;

  /** See Offer.durationMinutes in @korva/types. Null once cleared. */
  @Prop({ type: Number, min: 1 })
  durationMinutes?: number | null;

  /** See Offer.bookingUnit in @korva/types. Absent means "slot". */
  @Prop({ type: String, enum: ['slot', 'night'] })
  bookingUnit?: 'slot' | 'night';

  @Prop({ type: Number, min: 1 })
  minNights?: number | null;

  /** See Offer.bufferMinutes in @korva/types. */
  @Prop({ type: Number, min: 0 })
  bufferMinutes?: number | null;

  /** See Offer.compareAtPrice in @korva/types. Null once cleared. */
  @Prop({ type: Number, min: 0 })
  compareAtPrice?: number | null;

  /** See OfferOptionGroup in @korva/types. Stored as plain objects with client-generated ids;
   *  `default: undefined` so an offer without options stays without the key. */
  @Prop({ type: [Object], default: undefined })
  optionGroups?: OfferOptionGroup[];
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
