import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idToJson } from '../../../core/mongoose/schema-options';

export type StockLevelDocument = HydratedDocument<StockLevel>;

/**
 * Per-warehouse stock breakdown (Phase C2) — never directly CRUD'd by a human; rows are created/
 * mutated only as a side effect of OffersService.adjustStock/recordStockMovement being called
 * with a `warehouseId`. `quantity` here is one warehouse's share of the offer's (or variant's)
 * total; Offer.stockOnHand/OfferVariant.stockOnHand is maintained as the sum of every StockLevel
 * row for that offer/variant once any row exists — see StockLevelsRepository's doc comment for
 * why the two are never updated as a single cross-document atomic operation for the manual
 * (non-order) mutation paths this integrates with.
 */
@Schema({ timestamps: true, collection: 'stock_levels', toJSON: idToJson })
export class StockLevel {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Offer', required: true, index: true })
  offerId!: Types.ObjectId;

  /** `null` (never `undefined`) means this row is the offer's own (non-variant) stock at this
   *  warehouse — stored as an explicit literal, not an absent field, so the compound unique
   *  index below can treat every "no variant" row consistently (Mongo can't upsert a document
   *  matched via `{$exists: false}`). */
  @Prop({ type: Types.ObjectId, default: null })
  variantId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Warehouse', required: true, index: true })
  warehouseId!: Types.ObjectId;

  @Prop({ required: true, min: 0, default: 0 })
  quantity!: number;
}

export const StockLevelSchema = SchemaFactory.createForClass(StockLevel);
StockLevelSchema.index(
  { organizationId: 1, offerId: 1, variantId: 1, warehouseId: 1 },
  { unique: true },
);
StockLevelSchema.index({ organizationId: 1, warehouseId: 1 });
