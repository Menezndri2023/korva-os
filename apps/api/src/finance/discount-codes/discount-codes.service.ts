import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClientSession, Types } from 'mongoose';
import type {
  CreateDiscountCodeInput,
  UpdateDiscountCodeInput,
} from '@korva/validation';
import type { Pagination } from '@korva/types';
import {
  DiscountCodesRepository,
  FindDiscountCodesOptions,
} from './discount-codes.repository';
import { DiscountCodeDocument } from './schemas/discount-code.schema';
import { EventBusService } from '../../core/events/event-bus.service';
import type { ResolvedDiscount } from '../../shared/line-item.schema';

export interface DiscountCodeReservation {
  discountCodeId: string;
  resolved: ResolvedDiscount;
}

@Injectable()
export class DiscountCodesService {
  constructor(
    private readonly discountCodesRepository: DiscountCodesRepository,
    private readonly eventBus: EventBusService,
  ) {}

  async create(
    organizationId: string,
    input: CreateDiscountCodeInput,
  ): Promise<DiscountCodeDocument> {
    const code = normalizeCode(input.code);
    const existing = await this.discountCodesRepository.findByCode(
      organizationId,
      code,
    );
    if (existing) {
      throw new BadRequestException({
        code: 'DISCOUNT_CODE_ALREADY_EXISTS',
        message: `A discount code "${code}" already exists`,
      });
    }

    return this.discountCodesRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      code,
      type: input.type,
      value: input.value,
      currency: input.currency,
      startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
      maxRedemptions: input.maxRedemptions,
      scope: input.scope,
      offerIds: input.offerIds.map((id) => new Types.ObjectId(id)),
      active: input.active,
    });
  }

  async getById(
    organizationId: string,
    id: string,
  ): Promise<DiscountCodeDocument> {
    const discountCode = await this.discountCodesRepository.findById(
      organizationId,
      id,
    );
    if (!discountCode) {
      throw new NotFoundException({
        code: 'DISCOUNT_CODE_NOT_FOUND',
        message: 'Discount code not found',
      });
    }
    return discountCode;
  }

  async list(
    organizationId: string,
    query: FindDiscountCodesOptions,
  ): Promise<{ data: DiscountCodeDocument[]; pagination: Pagination }> {
    const { data, total } = await this.discountCodesRepository.findAll(
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
    id: string,
    input: UpdateDiscountCodeInput,
  ): Promise<DiscountCodeDocument> {
    const updated = await this.discountCodesRepository.update(
      organizationId,
      id,
      {
        startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
        maxRedemptions: input.maxRedemptions,
        active: input.active,
      },
    );
    if (!updated) {
      throw new NotFoundException({
        code: 'DISCOUNT_CODE_NOT_FOUND',
        message: 'Discount code not found',
      });
    }
    return updated;
  }

  async delete(organizationId: string, id: string): Promise<void> {
    const deleted = await this.discountCodesRepository.delete(
      organizationId,
      id,
    );
    if (!deleted) {
      throw new NotFoundException({
        code: 'DISCOUNT_CODE_NOT_FOUND',
        message: 'Discount code not found',
      });
    }
  }

  /**
   * Validates scope eligibility (a non-concurrency concern — doesn't need atomicity) THEN
   * atomically reserves a redemption slot. `session`, when given, ties the redemption increment
   * to the caller's transaction, so a downstream failure (e.g. InventoryService.reserveStock
   * rejecting for insufficient stock in the same checkout) rolls this back too.
   */
  async validateAndReserve(
    organizationId: string,
    code: string,
    context: { offerIds: string[] },
    session?: ClientSession,
  ): Promise<DiscountCodeReservation> {
    const normalized = normalizeCode(code);
    const existing = await this.discountCodesRepository.findByCode(
      organizationId,
      normalized,
    );
    if (!existing) {
      throw new NotFoundException({
        code: 'DISCOUNT_CODE_NOT_FOUND',
        message: 'Discount code not found',
      });
    }
    if (
      existing.scope === 'offers' &&
      !context.offerIds.some((offerId) =>
        existing.offerIds.some((id) => id.toString() === offerId),
      )
    ) {
      throw new BadRequestException({
        code: 'DISCOUNT_CODE_INELIGIBLE',
        message: 'This discount code does not apply to any item in this order',
      });
    }

    const reserved = await this.discountCodesRepository.reserveIfEligible(
      organizationId,
      normalized,
      new Date(),
      session,
    );
    if (!reserved) {
      throw new BadRequestException({
        code: 'DISCOUNT_CODE_EXHAUSTED',
        message:
          'This discount code is no longer eligible (expired, inactive, or fully redeemed)',
      });
    }

    await this.eventBus.publish(organizationId, 'discount_code.redeemed', {
      discountCodeId: reserved.id as string,
    });
    if (
      reserved.maxRedemptions !== undefined &&
      reserved.redemptionsCount >= reserved.maxRedemptions
    ) {
      await this.eventBus.publish(organizationId, 'discount_code.exhausted', {
        discountCodeId: reserved.id as string,
      });
    }

    return {
      discountCodeId: reserved.id as string,
      resolved: { type: reserved.type, value: reserved.value },
    };
  }

  releaseIfApplied(
    organizationId: string,
    discountCodeId: string | undefined,
    session?: ClientSession,
  ): Promise<void> {
    if (!discountCodeId) return Promise.resolve();
    return this.discountCodesRepository
      .release(organizationId, discountCodeId, session)
      .then(() => undefined);
  }
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}
