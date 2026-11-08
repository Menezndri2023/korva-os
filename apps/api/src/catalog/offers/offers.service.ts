import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClientSession, Types } from 'mongoose';
import type {
  AdjustStockInput,
  CreateOfferInput,
  ListOffersQuery,
  ListStockMovementsQuery,
  RecordStockMovementInput,
  UpdateOfferInput,
} from '@korva/validation';
import type { Pagination } from '@korva/types';
import { OffersRepository } from './offers.repository';
import { OfferReferencesRepository } from './offer-references.repository';
import { StockMovementsRepository } from './stock-movements.repository';
import { OfferDocument } from './schemas/offer.schema';
import { StockMovementDocument } from './schemas/stock-movement.schema';
import { StockLevelsRepository } from '../warehouses/stock-levels.repository';
import { WarehousesService } from '../warehouses/warehouses.service';
import { CustomFieldsService } from '../../custom-fields/custom-fields.service';
import { AuditService } from '../../audit/audit.service';
import { EventBusService } from '../../core/events/event-bus.service';
import { EntitlementsService } from '../../subscriptions/entitlements.service';

type VariantInput = NonNullable<UpdateOfferInput['variants']>[number];

/** A promotion shows a struck-through "before" price; one that is not above the real price would
 *  advertise a discount that does not exist. */
function assertCompareAtPriceHigher(
  compareAtPrice: number | null | undefined,
  amount: number,
): void {
  if (compareAtPrice != null && compareAtPrice <= amount) {
    throw new BadRequestException({
      code: 'COMPARE_AT_PRICE_NOT_HIGHER',
      message: 'The price before promotion must be higher than the price',
    });
  }
}

/**
 * Applies an edited variant list onto the stored one WITHOUT reissuing ids.
 *
 * `variants` is a whole-array replacement, and Mongoose gives every array entry without an `_id`
 * a fresh one — so before this, saving an offer re-created all of its variants under new ids,
 * orphaning the order lines, carts, wishlists and per-warehouse StockLevel rows that pointed at
 * the old ones. Entries that carry an `id` now keep it.
 *
 * They also keep their stored stock: stock moves through adjustStock/recordStockMovement and
 * order reservations, which leave a ledger entry; a catalogue edit must not silently overwrite a
 * count. Only a NEW variant takes the stock given with it. A variant left out of the list is
 * removed, as before.
 */
function mergeVariants(current: OfferDocument, input: VariantInput[]) {
  const stored = new Map(
    current.variants.map((variant) => [
      String((variant as unknown as { _id: Types.ObjectId })._id),
      variant,
    ]),
  );
  const seen = new Set<string>();
  return input.map((variant) => {
    if (!variant.id) {
      return {
        name: variant.name,
        sku: variant.sku,
        barcode: variant.barcode,
        priceOverride: variant.priceOverride,
        stockOnHand: variant.stockOnHand,
      };
    }
    const existing = stored.get(variant.id);
    if (!existing || seen.has(variant.id)) {
      throw new BadRequestException({
        code: 'VARIANT_NOT_FOUND',
        message: `Variant ${variant.id} does not belong to this offer`,
      });
    }
    seen.add(variant.id);
    return {
      _id: new Types.ObjectId(variant.id),
      name: variant.name,
      sku: variant.sku,
      barcode: variant.barcode,
      priceOverride: variant.priceOverride,
      stockOnHand: existing.stockOnHand,
    };
  });
}

@Injectable()
export class OffersService {
  constructor(
    private readonly offersRepository: OffersRepository,
    private readonly offerReferencesRepository: OfferReferencesRepository,
    private readonly stockMovementsRepository: StockMovementsRepository,
    private readonly stockLevelsRepository: StockLevelsRepository,
    private readonly warehousesService: WarehousesService,
    private readonly customFieldsService: CustomFieldsService,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBusService,
    private readonly entitlementsService: EntitlementsService,
  ) {}

  async create(
    organizationId: string,
    userId: string,
    input: CreateOfferInput,
  ): Promise<OfferDocument> {
    assertCompareAtPriceHigher(input.compareAtPrice, input.pricing.amount);
    if (input.variants.length > 0) {
      await this.entitlementsService.assertFeature(
        organizationId,
        'offer_variants',
      );
    }
    if (input.featured) {
      await this.entitlementsService.assertFeature(
        organizationId,
        'featured_offers',
      );
    }
    if (input.compareAtPrice != null) {
      await this.entitlementsService.assertFeature(
        organizationId,
        'compare_at_price',
      );
    }
    // An archived offer is outside the count, so creating one never needs room.
    if (input.status !== 'archived') {
      await this.entitlementsService.assertCountWithinLimit(
        organizationId,
        'offers',
      );
    }
    if (input.variants.some((variant) => variant.id)) {
      throw new BadRequestException({
        code: 'VARIANT_NOT_FOUND',
        message: 'A new offer cannot refer to existing variant ids',
      });
    }
    const customFields = await this.customFieldsService.validateValues(
      organizationId,
      'offers',
      input.customFields,
    );

    const offer = await this.offersRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      type: input.type,
      name: input.name,
      description: input.description,
      images: input.images,
      categories: input.categories,
      pricing: input.pricing,
      sku: input.sku,
      barcode: input.barcode,
      attributes: input.attributes,
      isBundle: input.isBundle,
      bundleItems: input.bundleItems?.map((item) => ({
        offerId: new Types.ObjectId(item.offerId),
        quantity: item.quantity,
      })),
      variants: input.variants,
      status: input.status,
      customFields,
      trackStock: input.trackStock,
      stockOnHand: input.stockOnHand,
      lowStockThreshold: input.lowStockThreshold,
      durationMinutes: input.durationMinutes,
      compareAtPrice: input.compareAtPrice,
      featured: input.featured,
      optionGroups: input.optionGroups,
      bookingUnit: input.bookingUnit,
      minNights: input.minNights,
      bufferMinutes: input.bufferMinutes,
      depositPercent: input.depositPercent,
    });

    await this.auditService.record({
      organizationId,
      userId,
      action: 'CREATE',
      entity: 'offer',
      entityId: offer.id as string,
    });

    await this.eventBus.publish(organizationId, 'offer.created', {
      offerId: offer.id as string,
      type: offer.type,
      name: offer.name,
    });

    return offer;
  }

  async getById(organizationId: string, id: string): Promise<OfferDocument> {
    const offer = await this.offersRepository.findById(organizationId, id);
    if (!offer) {
      throw new NotFoundException({
        code: 'OFFER_NOT_FOUND',
        message: 'Offer not found',
      });
    }
    return offer;
  }

  /**
   * Batched equivalent of calling getById() once per id — a single `$in` query
   * (OffersRepository.findByIds) instead of N round trips. Used by
   * OrdersService.createFromCart to price every cart line item without an N+1 query per
   * checkout. Throws the same OFFER_NOT_FOUND as getById() if any requested id doesn't resolve
   * to an offer in this organization, so callers get the exact same "which offer" story as
   * before, just from one query instead of many.
   */
  async getManyByIds(
    organizationId: string,
    ids: string[],
    session?: ClientSession,
  ): Promise<Map<string, OfferDocument>> {
    const offers = await this.offersRepository.findByIds(
      organizationId,
      ids,
      session,
    );
    const byId = new Map(offers.map((offer) => [offer.id as string, offer]));

    const missing = ids.some((id) => !byId.has(id));
    if (missing) {
      throw new NotFoundException({
        code: 'OFFER_NOT_FOUND',
        message: 'Offer not found',
      });
    }

    return byId;
  }

  /**
   * Same batched `$in` query as getManyByIds, but tolerant of a missing id instead of throwing —
   * for a display-only listing (e.g. a wishlist) where an offer referenced by an older row may
   * have since been deleted, and the right behavior is to simply omit it, not fail the whole
   * request. Never use this where price/availability integrity matters (order/cart pricing) —
   * getManyByIds's strictness exists specifically for that case.
   */
  async findManyByIds(
    organizationId: string,
    ids: string[],
  ): Promise<OfferDocument[]> {
    return this.offersRepository.findByIds(organizationId, ids);
  }

  async list(
    organizationId: string,
    query: ListOffersQuery,
  ): Promise<{ data: OfferDocument[]; pagination: Pagination }> {
    const { data, total } = await this.offersRepository.findAll(
      organizationId,
      query,
    );
    return {
      data,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  distinctActiveCategories(organizationId: string): Promise<string[]> {
    return this.offersRepository.distinctActiveCategories(organizationId);
  }

  async update(
    organizationId: string,
    userId: string,
    id: string,
    input: UpdateOfferInput,
  ): Promise<OfferDocument> {
    const customFields =
      input.customFields !== undefined
        ? await this.customFieldsService.validateValues(
            organizationId,
            'offers',
            input.customFields,
          )
        : undefined;

    // Both checks need the stored offer: the price rule may compare a new compare-at price with
    // the stored price (or the reverse), and variants are merged onto the stored ones.
    const needsCurrent =
      input.variants !== undefined ||
      input.compareAtPrice != null ||
      input.pricing !== undefined ||
      (input.status !== undefined && input.status !== 'archived');
    const current = needsCurrent
      ? await this.getById(organizationId, id)
      : undefined;
    // Paid features are checked on what is NEW only: an offer created under a higher plan keeps
    // its variants and its promotion after a downgrade, and can still be edited.
    if (input.variants?.some((variant) => !variant.id)) {
      await this.entitlementsService.assertFeature(
        organizationId,
        'offer_variants',
      );
    }
    // Marking is refused below Pro; un-marking is always allowed.
    if (input.featured === true) {
      await this.entitlementsService.assertFeature(
        organizationId,
        'featured_offers',
      );
    }
    if (
      input.compareAtPrice != null &&
      input.compareAtPrice !== current?.compareAtPrice
    ) {
      await this.entitlementsService.assertFeature(
        organizationId,
        'compare_at_price',
      );
    }
    // Un-archiving brings an offer back into the plan's count.
    if (
      current?.status === 'archived' &&
      input.status !== undefined &&
      input.status !== 'archived'
    ) {
      await this.entitlementsService.assertCountWithinLimit(
        organizationId,
        'offers',
      );
    }
    if (current) {
      assertCompareAtPriceHigher(
        input.compareAtPrice === undefined
          ? current.compareAtPrice
          : input.compareAtPrice,
        input.pricing?.amount ?? current.pricing.amount,
      );
    }

    const updated = await this.offersRepository.update(organizationId, id, {
      ...input,
      bundleItems: input.bundleItems?.map((item) => ({
        offerId: new Types.ObjectId(item.offerId),
        quantity: item.quantity,
      })),
      ...(input.variants !== undefined && current
        ? { variants: mergeVariants(current, input.variants) }
        : {}),
      ...(customFields !== undefined ? { customFields } : {}),
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'OFFER_NOT_FOUND',
        message: 'Offer not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'offer',
      entityId: id,
    });

    return updated;
  }

  /** Manual stock correction (stocktake, restock delivery) — sets stockOnHand to an absolute
   *  value rather than a delta, since that's what a physical count actually produces. Requires
   *  the offer to already have trackStock enabled (turn tracking on via update() first).
   *  Variant-aware: pass `variantId` to correct one variant's count instead of the offer's own —
   *  also records a `correction` StockMovement for the resulting delta, so this absolute-set
   *  action still leaves a real audit trail rather than silently overwriting the counter.
   *
   *  Phase C2 (docs/KORVA_OS_V2_AUDIT.md §2.4): when `input.warehouseId` is given, `stockOnHand`
   *  sets THAT warehouse's own count, not the offer's overall total — the aggregate is adjusted
   *  by the resulting delta instead of being overwritten, so other warehouses' stock is never
   *  touched. Omitting `warehouseId` keeps today's exact behavior unchanged: a direct absolute
   *  set of the aggregate, with no StockLevel row involved at all. */
  async adjustStock(
    organizationId: string,
    userId: string,
    id: string,
    input: AdjustStockInput,
  ): Promise<OfferDocument> {
    const offer = await this.getById(organizationId, id);
    if (!offer.trackStock) {
      throw new BadRequestException({
        code: 'STOCK_TRACKING_NOT_ENABLED',
        message: 'Enable trackStock on this offer before adjusting stock',
      });
    }

    const before = input.variantId
      ? offer.variants.find(
          (v) =>
            (v as unknown as { _id: Types.ObjectId })._id.toString() ===
            input.variantId,
        )?.stockOnHand
      : offer.stockOnHand;
    if (input.variantId && before === undefined) {
      throw new NotFoundException({
        code: 'OFFER_VARIANT_NOT_FOUND',
        message: 'Variant not found on this offer',
      });
    }

    let aggregateTarget = input.stockOnHand;
    if (input.warehouseId) {
      await this.warehousesService.getById(organizationId, input.warehouseId);
      const { previousQuantity } = await this.stockLevelsRepository.setQuantity(
        organizationId,
        id,
        input.variantId,
        input.warehouseId,
        input.stockOnHand,
      );
      // Preserve every OTHER warehouse's contribution to the aggregate — only this warehouse's
      // own delta moves the total, never a blind overwrite.
      aggregateTarget = (before ?? 0) - previousQuantity + input.stockOnHand;
    }

    const updated = input.variantId
      ? await this.offersRepository.updateVariantStock(
          organizationId,
          id,
          input.variantId,
          aggregateTarget,
        )
      : await this.offersRepository.update(organizationId, id, {
          stockOnHand: aggregateTarget,
        });
    if (!updated) {
      throw new NotFoundException({
        code: 'OFFER_NOT_FOUND',
        message: 'Offer not found',
      });
    }

    const delta = aggregateTarget - (before ?? 0);
    if (delta !== 0) {
      await this.stockMovementsRepository.create({
        organizationId: new Types.ObjectId(organizationId),
        offerId: new Types.ObjectId(id),
        variantId: input.variantId
          ? new Types.ObjectId(input.variantId)
          : undefined,
        type: 'correction',
        quantity: delta,
        stockAfter: aggregateTarget,
        userId: new Types.ObjectId(userId),
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'offer',
      entityId: id,
      metadata: {
        stockAdjustedTo: aggregateTarget,
        variantId: input.variantId,
        warehouseId: input.warehouseId,
      },
    });

    return updated;
  }

  /** The "logistics" side of stock management — a delta-with-reason entry (supplier delivery,
   *  breakage, a signed correction), always recorded as a StockMovement, never a silent counter
   *  mutation. Applied atomically via the same $inc-based repository methods InventoryService
   *  uses for order-driven changes, so a manual entry and a concurrent sale can never race into
   *  a lost update. Subtractive types (damaged, or a negative correction) are guarded against
   *  taking stock below 0, same as an order reservation would be.
   *
   *  Phase C2: when `input.warehouseId` is given, the same delta also applies to that
   *  warehouse's own StockLevel row. The two writes aren't in a Mongo transaction (matching this
   *  codebase's own accepted precedent for PurchaseOrdersService.receive's per-line loop), so for
   *  a decrement the AGGREGATE is adjusted first (it's the pre-existing, battle-tested guard);
   *  if the warehouse-specific decrement then fails — this location alone doesn't have enough,
   *  even though the org's total does — the aggregate decrement is explicitly rolled back
   *  (re-incremented) before rejecting, so the two never drift out of sync. */
  async recordStockMovement(
    organizationId: string,
    userId: string,
    offerId: string,
    input: RecordStockMovementInput,
  ): Promise<StockMovementDocument> {
    const offer = await this.getById(organizationId, offerId);
    if (!offer.trackStock) {
      throw new BadRequestException({
        code: 'STOCK_TRACKING_NOT_ENABLED',
        message:
          'Enable trackStock on this offer before recording stock movements',
      });
    }
    if (
      input.variantId &&
      !offer.variants.some(
        (v) =>
          (v as unknown as { _id: Types.ObjectId })._id.toString() ===
          input.variantId,
      )
    ) {
      throw new NotFoundException({
        code: 'OFFER_VARIANT_NOT_FOUND',
        message: 'Variant not found on this offer',
      });
    }
    if (input.warehouseId) {
      await this.warehousesService.getById(organizationId, input.warehouseId);
    }

    // Direction is determined by TYPE, not by the input quantity's own sign: the schema requires
    // a positive quantity for received/returned/damaged (a physical count is never negative),
    // but "damaged" still removes stock — only "correction" carries an already-signed delta.
    // Using input.quantity's sign directly here would silently treat every damaged/received/
    // returned entry as an addition, which is exactly wrong for "damaged".
    const delta =
      input.type === 'damaged'
        ? -Math.abs(input.quantity)
        : input.type === 'correction'
          ? input.quantity
          : Math.abs(input.quantity);

    const result =
      delta > 0
        ? await this.offersRepository.incrementStock(
            organizationId,
            offerId,
            delta,
            input.variantId,
          )
        : await this.offersRepository.decrementStockIfAvailable(
            organizationId,
            offerId,
            -delta,
            input.variantId,
          );
    if (!result) {
      throw new BadRequestException({
        code: 'INSUFFICIENT_STOCK',
        message: 'Not enough stock available for this movement',
      });
    }

    if (input.warehouseId) {
      if (delta > 0) {
        await this.stockLevelsRepository.incrementQuantity(
          organizationId,
          offerId,
          input.variantId,
          input.warehouseId,
          delta,
        );
      } else {
        const stockLevel = await this.stockLevelsRepository.decrementQuantity(
          organizationId,
          offerId,
          input.variantId,
          input.warehouseId,
          -delta,
        );
        if (!stockLevel) {
          // Roll back the aggregate decrement already applied above — this specific warehouse
          // doesn't have enough, even though the offer's total (spread across other warehouses)
          // does. Never leaves the two counters out of sync.
          await this.offersRepository.incrementStock(
            organizationId,
            offerId,
            -delta,
            input.variantId,
          );
          throw new BadRequestException({
            code: 'INSUFFICIENT_STOCK_AT_WAREHOUSE',
            message: 'Not enough stock at this warehouse for this movement',
          });
        }
      }
    }

    const movement = await this.stockMovementsRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      offerId: new Types.ObjectId(offerId),
      variantId: input.variantId
        ? new Types.ObjectId(input.variantId)
        : undefined,
      type: input.type,
      quantity: delta,
      stockAfter: result.stockAfter,
      reason: input.reason,
      unitCost: input.type === 'received' ? input.unitCost : undefined,
      userId: new Types.ObjectId(userId),
    });

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'offer',
      entityId: offerId,
      metadata: {
        stockMovementType: input.type,
        quantity: input.quantity,
        warehouseId: input.warehouseId,
        variantId: input.variantId,
      },
    });

    return movement;
  }

  async listStockMovements(
    organizationId: string,
    offerId: string,
    query: ListStockMovementsQuery,
  ): Promise<{ data: StockMovementDocument[]; pagination: Pagination }> {
    const { data, total } = await this.stockMovementsRepository.findAll(
      organizationId,
      offerId,
      query,
    );
    return {
      data,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  /** Per-warehouse breakdown for one offer (Phase C2) — empty for any offer that has never had a
   *  warehouse-scoped stock operation applied to it. */
  getStockLevels(organizationId: string, offerId: string) {
    return this.stockLevelsRepository.listForOffer(organizationId, offerId);
  }

  async delete(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<void> {
    // Checked before the delete itself: offerId is a required/persistent field on every
    // entity that carries one (order/quote/invoice line items, bookings, cart items), and
    // none of them support a soft-delete/archival state that would make an existing reference
    // safe to orphan — same policy already applied to contact deletion (LOT F5). Status is
    // deliberately not considered: even a cancelled order or an abandoned cart is a real
    // historical record.
    const hasReferences = await this.offerReferencesRepository.hasAnyReference(
      organizationId,
      id,
    );
    if (hasReferences) {
      throw new ConflictException({
        code: 'OFFER_IN_USE',
        message:
          'This offer is still referenced by other records and cannot be deleted',
      });
    }

    const deleted = await this.offersRepository.delete(organizationId, id);
    if (!deleted) {
      throw new NotFoundException({
        code: 'OFFER_NOT_FOUND',
        message: 'Offer not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'DELETE',
      entity: 'offer',
      entityId: id,
    });
  }
}
