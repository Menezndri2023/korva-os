import { BadRequestException, Injectable } from '@nestjs/common';
import { ClientSession, Types } from 'mongoose';
import { OffersRepository } from './offers.repository';
import { StockMovementsRepository } from './stock-movements.repository';
import { EventBusService } from '../../core/events/event-bus.service';
import type { OfferDocument } from './schemas/offer.schema';

export interface StockLineItem {
  offerId?: string;
  variantId?: string;
  quantity: number;
}

/**
 * Generic stock ledger shared by every vertical that sells a trackable product (Commerce retail,
 * Salon retail, Restaurant menu items) — never forked per sector. Stock is reserved at
 * order-creation time (not fulfillment): that's the moment two concurrent buyers actually
 * contend for the last unit, so it's the moment that must be atomic. This does mean stock stays
 * held by an order stuck in 'pending' forever (no stale-order expiry sweep exists) — an accepted
 * v1 gap, not an oversight.
 *
 * Variant-aware: an offer with variants (e.g. size/color) tracks stock per variant, entirely
 * independent of its siblings — see OffersRepository.decrementStockIfAvailable/incrementStock.
 * Every change here also writes a StockMovement row (see that schema's own doc) so "why is this
 * at 3 units" is always answerable from real history, not just the current counter.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly offersRepository: OffersRepository,
    private readonly stockMovementsRepository: StockMovementsRepository,
    private readonly eventBus: EventBusService,
  ) {}

  /** Reserves (decrements) stock for every tracked offer/variant referenced in `items`,
   *  atomically per line. Untracked offers (trackStock: false) and line items with no offerId
   *  are skipped entirely — this is a strict superset of "do nothing" for every order that
   *  doesn't sell tracked stock. Throws INSUFFICIENT_STOCK (aborting the caller's transaction)
   *  naming the first offer that couldn't be reserved. */
  async reserveStock(
    organizationId: string,
    items: StockLineItem[],
    session: ClientSession,
    referenceId?: string,
  ): Promise<void> {
    const lines = sumQuantitiesByLine(items);
    if (lines.size === 0) return;

    const offerIds = [...new Set([...lines.values()].map((l) => l.offerId))];
    const offers = await this.offersRepository.findByIds(
      organizationId,
      offerIds,
      session,
    );
    const trackedOffersById = new Map(
      offers
        .filter((offer) => offer.trackStock)
        .map((o) => [o.id as string, o]),
    );

    for (const { offerId, variantId, quantity } of lines.values()) {
      const offer = trackedOffersById.get(offerId);
      if (!offer) continue;

      const result = await this.offersRepository.decrementStockIfAvailable(
        organizationId,
        offerId,
        quantity,
        variantId,
        session,
      );
      if (!result) {
        throw new BadRequestException({
          code: 'INSUFFICIENT_STOCK',
          message: `Not enough stock available for offer ${offerId}`,
        });
      }

      await this.stockMovementsRepository.create({
        organizationId: new Types.ObjectId(organizationId),
        offerId: new Types.ObjectId(offerId),
        variantId: variantId ? new Types.ObjectId(variantId) : undefined,
        type: 'sold',
        quantity: -quantity,
        stockAfter: result.stockAfter,
        referenceType: referenceId ? 'order' : undefined,
        referenceId: referenceId ? new Types.ObjectId(referenceId) : undefined,
      });

      await this.maybeAlertLowStock(
        organizationId,
        offerId,
        variantId,
        offer,
        result.stockAfter,
      );
    }
  }

  /** Restores stock previously reserved (order cancelled, item removed from an open tab).
   *  Untracked offers/missing offerIds are skipped the same way reserveStock skips them. */
  async restockItems(
    organizationId: string,
    items: StockLineItem[],
    session?: ClientSession,
    referenceId?: string,
  ): Promise<void> {
    const lines = sumQuantitiesByLine(items);
    for (const { offerId, variantId, quantity } of lines.values()) {
      const result = await this.offersRepository.incrementStock(
        organizationId,
        offerId,
        quantity,
        variantId,
        session,
      );
      if (!result) continue;

      await this.stockMovementsRepository.create({
        organizationId: new Types.ObjectId(organizationId),
        offerId: new Types.ObjectId(offerId),
        variantId: variantId ? new Types.ObjectId(variantId) : undefined,
        type: 'returned',
        quantity,
        stockAfter: result.stockAfter,
        referenceType: referenceId ? 'order' : undefined,
        referenceId: referenceId ? new Types.ObjectId(referenceId) : undefined,
      });
    }
  }

  /**
   * `offer.stock_depleted` fires only at exactly 0 (unchanged from before — an existing,
   * potentially org-configured Workflow trigger name, never renamed). `offer.low_stock` is new:
   * fires whenever stock is at or below a real, explicitly-configured lowStockThreshold (a
   * threshold of 0/unset never fires this — that's what stock_depleted already covers). Both can
   * fire from the same decrement; Recommendation creation is idempotent per (rule, entity), so a
   * decrement that keeps triggering "still low" every time is a harmless no-op after the first.
   */
  private async maybeAlertLowStock(
    organizationId: string,
    offerId: string,
    variantId: string | undefined,
    offer: OfferDocument,
    stockAfter: number,
  ): Promise<void> {
    if (stockAfter === 0) {
      await this.eventBus.publish(organizationId, 'offer.stock_depleted', {
        offerId,
        variantId,
      });
    }
    const threshold = offer.lowStockThreshold;
    if (threshold != null && threshold > 0 && stockAfter <= threshold) {
      await this.eventBus.publish(organizationId, 'offer.low_stock', {
        offerId,
        variantId,
        stockOnHand: stockAfter,
        lowStockThreshold: threshold,
      });
    }
  }
}

function sumQuantitiesByLine(
  items: StockLineItem[],
): Map<string, { offerId: string; variantId?: string; quantity: number }> {
  const lines = new Map<
    string,
    { offerId: string; variantId?: string; quantity: number }
  >();
  for (const item of items) {
    if (!item.offerId) continue;
    const key = `${item.offerId}:${item.variantId ?? ''}`;
    const existing = lines.get(key);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      lines.set(key, {
        offerId: item.offerId,
        variantId: item.variantId,
        quantity: item.quantity,
      });
    }
  }
  return lines;
}
