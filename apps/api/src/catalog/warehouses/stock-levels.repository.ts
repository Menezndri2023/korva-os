import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { StockLevel, StockLevelDocument } from './schemas/stock-level.schema';

function normalizeVariantId(variantId?: string): Types.ObjectId | null {
  return variantId ? new Types.ObjectId(variantId) : null;
}

/**
 * Per-warehouse stock breakdown (Phase C2). Every write here is a SEPARATE document from the
 * Offer/OfferVariant aggregate it must stay in sync with — OffersService is responsible for
 * updating both, in an order that fails safe (see its own doc comments), since none of these
 * manual/administrative operations are wrapped in a cross-document Mongo transaction (matching
 * this codebase's own accepted precedent for PurchaseOrdersService.receive's per-line loop).
 */
@Injectable()
export class StockLevelsRepository {
  constructor(
    @InjectModel(StockLevel.name)
    private readonly stockLevelModel: Model<StockLevelDocument>,
  ) {}

  findOne(
    organizationId: string,
    offerId: string,
    variantId: string | undefined,
    warehouseId: string,
  ): Promise<StockLevelDocument | null> {
    return this.stockLevelModel
      .findOne({
        organizationId: new Types.ObjectId(organizationId),
        offerId: new Types.ObjectId(offerId),
        variantId: normalizeVariantId(variantId),
        warehouseId: new Types.ObjectId(warehouseId),
      })
      .exec();
  }

  listForOffer(
    organizationId: string,
    offerId: string,
  ): Promise<StockLevelDocument[]> {
    return this.stockLevelModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
        offerId: new Types.ObjectId(offerId),
      })
      .sort({ warehouseId: 1 })
      .exec();
  }

  listForWarehouse(
    organizationId: string,
    warehouseId: string,
  ): Promise<StockLevelDocument[]> {
    return this.stockLevelModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
        warehouseId: new Types.ObjectId(warehouseId),
        quantity: { $gt: 0 },
      })
      .sort({ offerId: 1 })
      .exec();
  }

  /** Absolute set (stocktake correction) — returns the row's quantity BEFORE this write too, so
   *  the caller can compute the delta to apply to the Offer/OfferVariant aggregate. Upserts:
   *  this is the entry point that first creates a warehouse's row for an offer. */
  async setQuantity(
    organizationId: string,
    offerId: string,
    variantId: string | undefined,
    warehouseId: string,
    quantity: number,
  ): Promise<{ stockLevel: StockLevelDocument; previousQuantity: number }> {
    const filter = {
      organizationId: new Types.ObjectId(organizationId),
      offerId: new Types.ObjectId(offerId),
      variantId: normalizeVariantId(variantId),
      warehouseId: new Types.ObjectId(warehouseId),
    };
    const existing = await this.stockLevelModel.findOne(filter).exec();
    const previousQuantity = existing?.quantity ?? 0;
    const stockLevel = await this.stockLevelModel
      .findOneAndUpdate(
        filter,
        { $set: { quantity } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    return { stockLevel: stockLevel, previousQuantity };
  }

  /** Unguarded — only ever called with a positive delta (received/returned/positive correction),
   *  same "no upper bound to restore past" reasoning as OffersRepository.incrementStock. Upserts:
   *  a warehouse's first-ever received unit is what creates its row. */
  incrementQuantity(
    organizationId: string,
    offerId: string,
    variantId: string | undefined,
    warehouseId: string,
    delta: number,
  ): Promise<StockLevelDocument> {
    return this.stockLevelModel
      .findOneAndUpdate(
        {
          organizationId: new Types.ObjectId(organizationId),
          offerId: new Types.ObjectId(offerId),
          variantId: normalizeVariantId(variantId),
          warehouseId: new Types.ObjectId(warehouseId),
        },
        { $inc: { quantity: delta } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  /** `$gte`-guarded, same shape as OffersRepository.decrementStockIfAvailable — never upserts
   *  (a row with no stock at this warehouse can't be decremented below zero into existing).
   *  Returns null if this specific warehouse doesn't have `amount` units, distinct from the
   *  offer's own aggregate having enough spread across other warehouses. */
  decrementQuantity(
    organizationId: string,
    offerId: string,
    variantId: string | undefined,
    warehouseId: string,
    amount: number,
  ): Promise<StockLevelDocument | null> {
    return this.stockLevelModel
      .findOneAndUpdate(
        {
          organizationId: new Types.ObjectId(organizationId),
          offerId: new Types.ObjectId(offerId),
          variantId: normalizeVariantId(variantId),
          warehouseId: new Types.ObjectId(warehouseId),
          quantity: { $gte: amount },
        },
        { $inc: { quantity: -amount } },
        { new: true },
      )
      .exec();
  }

  async existsForWarehouse(
    organizationId: string,
    warehouseId: string,
  ): Promise<boolean> {
    const count = await this.stockLevelModel
      .countDocuments({
        organizationId: new Types.ObjectId(organizationId),
        warehouseId: new Types.ObjectId(warehouseId),
        quantity: { $gt: 0 },
      })
      .exec();
    return count > 0;
  }
}
