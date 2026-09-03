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
  UpdateOfferInput,
} from '@korva/validation';
import type { Pagination } from '@korva/types';
import { OffersRepository } from './offers.repository';
import { OfferReferencesRepository } from './offer-references.repository';
import { OfferDocument } from './schemas/offer.schema';
import { CustomFieldsService } from '../../custom-fields/custom-fields.service';
import { AuditService } from '../../audit/audit.service';
import { EventBusService } from '../../core/events/event-bus.service';

@Injectable()
export class OffersService {
  constructor(
    private readonly offersRepository: OffersRepository,
    private readonly offerReferencesRepository: OfferReferencesRepository,
    private readonly customFieldsService: CustomFieldsService,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBusService,
  ) {}

  async create(
    organizationId: string,
    userId: string,
    input: CreateOfferInput,
  ): Promise<OfferDocument> {
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
      variants: input.variants,
      status: input.status,
      customFields,
      trackStock: input.trackStock,
      stockOnHand: input.stockOnHand,
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

    const updated = await this.offersRepository.update(organizationId, id, {
      ...input,
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
   *  the offer to already have trackStock enabled (turn tracking on via update() first). */
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

    const updated = await this.offersRepository.update(organizationId, id, {
      stockOnHand: input.stockOnHand,
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
      metadata: { stockAdjustedTo: input.stockOnHand },
    });

    return updated;
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
