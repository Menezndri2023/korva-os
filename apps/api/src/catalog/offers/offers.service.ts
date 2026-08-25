import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type {
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

@Injectable()
export class OffersService {
  constructor(
    private readonly offersRepository: OffersRepository,
    private readonly offerReferencesRepository: OfferReferencesRepository,
    private readonly customFieldsService: CustomFieldsService,
    private readonly auditService: AuditService,
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
    });

    await this.auditService.record({
      organizationId,
      userId,
      action: 'CREATE',
      entity: 'offer',
      entityId: offer.id as string,
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
