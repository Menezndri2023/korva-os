import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idToJson } from '../../../core/mongoose/schema-options';

export type WarehouseDocument = HydratedDocument<Warehouse>;

/**
 * Phase C2 (docs/KORVA_OS_V2_AUDIT.md §2.4) — the first physical-location concept in Inventory.
 * An organization that never creates a second Warehouse keeps seeing byte-identical behavior:
 * Offer.stockOnHand/OfferVariant.stockOnHand stay the single source of truth for stock exactly
 * as before C2 (see inventory.service.ts, unchanged). Only once StockLevel rows exist for an
 * offer does its stock start being tracked per-warehouse, with Offer.stockOnHand maintained as
 * the sum across every warehouse — see OffersService.adjustStock/recordStockMovement.
 */
@Schema({ timestamps: true, collection: 'warehouses', toJSON: idToJson })
export class Warehouse {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ required: true })
  name!: string;

  @Prop()
  address?: string;

  /** Exactly one warehouse per organization is ever the default at a time — see
   *  WarehousesService.create/update's unsetDefaultForOthers call, same pattern as
   *  crm/pipelines/pipelines.repository.ts. */
  @Prop({ default: false })
  isDefault!: boolean;
}

export const WarehouseSchema = SchemaFactory.createForClass(Warehouse);
WarehouseSchema.index({ organizationId: 1, name: 1 }, { unique: true });
