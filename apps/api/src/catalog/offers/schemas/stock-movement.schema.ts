import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { StockMovementType } from '@korva/types';
import { STOCK_MOVEMENT_TYPES } from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';

export type StockMovementDocument = HydratedDocument<StockMovement>;

/**
 * Append-only ledger — every stock change (automatic, from an order; manual, from staff) writes
 * one row here, in addition to (never instead of) mutating the live stockOnHand counter on
 * Offer/OfferVariant. Never updated or deleted: the "current stock" is always the mutable
 * counter, this collection exists purely for traceability/audit ("why is this offer at 3 units
 * — what happened to it"), which InventoryService's counter alone could never answer.
 */
@Schema({ timestamps: true, collection: 'stock_movements', toJSON: idToJson })
export class StockMovement {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Offer', required: true, index: true })
  offerId!: Types.ObjectId;

  /** Unset means this movement applies to the offer's own stockOnHand (no variants). */
  @Prop({ type: Types.ObjectId })
  variantId?: Types.ObjectId;

  @Prop({ type: String, enum: STOCK_MOVEMENT_TYPES, required: true })
  type!: StockMovementType;

  @Prop({ required: true })
  quantity!: number;

  @Prop({ required: true, min: 0 })
  stockAfter!: number;

  @Prop()
  reason?: string;

  @Prop({ type: String, enum: ['order'] })
  referenceType?: 'order';

  @Prop({ type: Types.ObjectId })
  referenceId?: Types.ObjectId;

  /** Only ever set on a `received` movement — the real per-unit cost, when known (from a
   *  purchase order's own line-item cost, or a manual entry). Phase C3 (docs/KORVA_OS_V2_AUDIT.md
   *  §2.4) valuation reads each offer's MOST RECENT costed `received` movement, never an
   *  invented/estimated figure — an offer with no costed movement is simply excluded from
   *  valuation rather than guessed at. */
  @Prop()
  unitCost?: number;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  userId?: Types.ObjectId;
}

export const StockMovementSchema = SchemaFactory.createForClass(StockMovement);
StockMovementSchema.index({ organizationId: 1, offerId: 1, createdAt: -1 });
