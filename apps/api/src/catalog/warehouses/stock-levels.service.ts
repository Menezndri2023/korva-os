import { Injectable } from '@nestjs/common';
import { StockLevelsRepository } from './stock-levels.repository';
import { StockLevelDocument } from './schemas/stock-level.schema';

/**
 * Thin read layer over StockLevelsRepository — the actual writes happen inside
 * OffersService.adjustStock/recordStockMovement, which must keep a StockLevel row and the
 * Offer/OfferVariant aggregate in sync in one place. This service exists for the read-only
 * endpoints (per-offer breakdown, per-warehouse contents).
 */
@Injectable()
export class StockLevelsService {
  constructor(private readonly stockLevelsRepository: StockLevelsRepository) {}

  listForOffer(
    organizationId: string,
    offerId: string,
  ): Promise<StockLevelDocument[]> {
    return this.stockLevelsRepository.listForOffer(organizationId, offerId);
  }

  listForWarehouse(
    organizationId: string,
    warehouseId: string,
  ): Promise<StockLevelDocument[]> {
    return this.stockLevelsRepository.listForWarehouse(
      organizationId,
      warehouseId,
    );
  }
}
