import { BadRequestException, Injectable } from '@nestjs/common';
import { ClientSession } from 'mongoose';
import { OffersRepository } from './offers.repository';
import { EventBusService } from '../../core/events/event-bus.service';

export interface StockLineItem {
  offerId?: string;
  quantity: number;
}

/**
 * Generic stock ledger shared by every vertical that sells a trackable product (Commerce retail,
 * Salon retail, Restaurant menu items) — never forked per sector. Stock is reserved at
 * order-creation time (not fulfillment): that's the moment two concurrent buyers actually
 * contend for the last unit, so it's the moment that must be atomic. This does mean stock stays
 * held by an order stuck in 'pending' forever (no stale-order expiry sweep exists) — an accepted
 * v1 gap, not an oversight.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly offersRepository: OffersRepository,
    private readonly eventBus: EventBusService,
  ) {}

  /** Reserves (decrements) stock for every tracked offer referenced in `items`, atomically per
   *  offer. Untracked offers (trackStock: false) and line items with no offerId are skipped
   *  entirely — this is a strict superset of "do nothing" for every order that doesn't sell
   *  tracked stock, which is every order today. Throws INSUFFICIENT_STOCK (aborting the caller's
   *  transaction) naming the first offer that couldn't be reserved. */
  async reserveStock(
    organizationId: string,
    items: StockLineItem[],
    session: ClientSession,
  ): Promise<void> {
    const quantityByOfferId = sumQuantitiesByOfferId(items);
    if (quantityByOfferId.size === 0) return;

    const offers = await this.offersRepository.findByIds(
      organizationId,
      [...quantityByOfferId.keys()],
      session,
    );
    const trackedIds = new Set(
      offers
        .filter((offer) => offer.trackStock)
        .map((offer) => offer.id as string),
    );

    for (const [offerId, quantity] of quantityByOfferId) {
      if (!trackedIds.has(offerId)) continue;

      const updated = await this.offersRepository.decrementStockIfAvailable(
        organizationId,
        offerId,
        quantity,
        session,
      );
      if (!updated) {
        throw new BadRequestException({
          code: 'INSUFFICIENT_STOCK',
          message: `Not enough stock available for offer ${offerId}`,
        });
      }
      if (updated.stockOnHand === 0) {
        await this.eventBus.publish(organizationId, 'offer.stock_depleted', {
          offerId,
        });
      }
    }
  }

  /** Restores stock previously reserved (order cancelled, item removed from an open tab).
   *  Untracked offers/missing offerIds are skipped the same way reserveStock skips them. */
  async restockItems(
    organizationId: string,
    items: StockLineItem[],
    session?: ClientSession,
  ): Promise<void> {
    const quantityByOfferId = sumQuantitiesByOfferId(items);
    for (const [offerId, quantity] of quantityByOfferId) {
      await this.offersRepository.incrementStock(
        organizationId,
        offerId,
        quantity,
        session,
      );
    }
  }
}

function sumQuantitiesByOfferId(items: StockLineItem[]): Map<string, number> {
  const quantityByOfferId = new Map<string, number>();
  for (const item of items) {
    if (!item.offerId) continue;
    quantityByOfferId.set(
      item.offerId,
      (quantityByOfferId.get(item.offerId) ?? 0) + item.quantity,
    );
  }
  return quantityByOfferId;
}
