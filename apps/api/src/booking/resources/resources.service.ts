import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type {
  AddBlockedSlotInput,
  CreateResourceInput,
  UpdateResourceInput,
} from '@korva/validation';
import { ResourcesRepository } from './resources.repository';
import { ResourceDocument } from './schemas/resource.schema';
import {
  UnsafeWebhookUrlError,
  assertSafeWebhookUrl,
} from '../../shared/safe-fetch';
import { MembershipsService } from '../../identity/memberships/memberships.service';
import { EntitlementsService } from '../../subscriptions/entitlements.service';

/** Same check already applied to outgoing workflow webhook URLs — an ICS feed URL is just as
 *  capable of being pointed at an internal service or cloud metadata endpoint. */
async function assertSafeCalendarUrl(url: string): Promise<void> {
  try {
    await assertSafeWebhookUrl(url);
  } catch (error) {
    if (error instanceof UnsafeWebhookUrlError) {
      throw new BadRequestException({
        code: 'UNSAFE_CALENDAR_URL',
        message: error.message,
      });
    }
    throw error;
  }
}

@Injectable()
export class ResourcesService {
  constructor(
    private readonly resourcesRepository: ResourcesRepository,
    private readonly membershipsService: MembershipsService,
    private readonly entitlementsService: EntitlementsService,
  ) {}

  async create(
    organizationId: string,
    input: CreateResourceInput,
  ): Promise<ResourceDocument> {
    if (input.externalCalendarUrl) {
      await assertSafeCalendarUrl(input.externalCalendarUrl);
    }
    if (input.membershipId) {
      await this.assertMembershipExists(organizationId, input.membershipId);
    }
    // Only an active bookable PERSON counts against the plan (bookable_staff): places and
    // equipment are not capped.
    if (input.type === 'person' && input.active !== false) {
      await this.entitlementsService.assertCountWithinLimit(
        organizationId,
        'bookable_staff',
      );
    }
    return this.resourcesRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      name: input.name,
      type: input.type,
      capacity: input.capacity,
      description: input.description,
      photo: input.photo,
      seats: input.seats,
      active: input.active,
      weeklyAvailability: input.weeklyAvailability,
      externalCalendarUrl: input.externalCalendarUrl,
      membershipId: input.membershipId
        ? new Types.ObjectId(input.membershipId)
        : undefined,
    });
  }

  /**
   * A business with booking switched on but no resource yet (the state right after signup —
   * nobody has opened "Équipe et ressources") had a "Réserver" button leading to an empty choice
   * and a form that could never be sent: every new salon, guesthouse or school took no booking.
   * This creates one bookable resource named after the business, open Monday to Saturday,
   * 9:00–18:00 — the owner renames it, changes its hours or adds the team whenever they like.
   *
   * Only when the organization has no resource at all, active or not: an owner who switched
   * theirs off made a choice. Not counted against the bookable-staff quota check (there is
   * nothing else, so it fits every plan).
   */
  async ensureDefaultResource(
    organizationId: string,
    organizationName: string,
  ): Promise<void> {
    if (
      (await this.resourcesRepository.countForOrganization(organizationId)) > 0
    )
      return;
    await this.resourcesRepository.upsertDefault(organizationId, {
      name: organizationName.slice(0, 120),
      type: 'person',
      capacity: 1,
      active: true,
      // 0 = Sunday, as in AvailabilityService.
      weeklyAvailability: [1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        dayOfWeek,
        startTime: '09:00',
        endTime: '18:00',
      })),
    });
  }

  list(
    organizationId: string,
    activeOnly: boolean,
    membershipId?: string,
  ): Promise<ResourceDocument[]> {
    return this.resourcesRepository.findAll(
      organizationId,
      activeOnly,
      membershipId,
    );
  }

  private async assertMembershipExists(
    organizationId: string,
    membershipId: string,
  ): Promise<void> {
    const membership = await this.membershipsService.findByIdForOrganization(
      membershipId,
      organizationId,
    );
    if (!membership) {
      throw new NotFoundException({
        code: 'MEMBERSHIP_NOT_FOUND',
        message: 'Membership not found',
      });
    }
  }

  async getById(organizationId: string, id: string): Promise<ResourceDocument> {
    const resource = await this.resourcesRepository.findById(
      organizationId,
      id,
    );
    if (!resource) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Resource not found',
      });
    }
    return resource;
  }

  async update(
    organizationId: string,
    id: string,
    input: UpdateResourceInput,
  ): Promise<ResourceDocument> {
    if (input.externalCalendarUrl) {
      await assertSafeCalendarUrl(input.externalCalendarUrl);
    }
    if (input.membershipId) {
      await this.assertMembershipExists(organizationId, input.membershipId);
    }
    if (input.type !== undefined || input.active !== undefined) {
      const current = await this.resourcesRepository.findById(
        organizationId,
        id,
      );
      const countedBefore = current?.type === 'person' && current.active;
      const countedAfter =
        (input.type ?? current?.type) === 'person' &&
        (input.active ?? current?.active ?? true);
      if (current && countedAfter && !countedBefore) {
        await this.entitlementsService.assertCountWithinLimit(
          organizationId,
          'bookable_staff',
        );
      }
    }
    const updated = await this.resourcesRepository.update(organizationId, id, {
      ...input,
      membershipId: input.membershipId
        ? new Types.ObjectId(input.membershipId)
        : undefined,
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Resource not found',
      });
    }
    return updated;
  }

  async addBlockedSlot(
    organizationId: string,
    id: string,
    input: AddBlockedSlotInput,
  ): Promise<ResourceDocument> {
    const updated = await this.resourcesRepository.addBlockedSlot(
      organizationId,
      id,
      {
        startAt: new Date(input.startAt),
        endAt: new Date(input.endAt),
        reason: input.reason,
      },
    );
    if (!updated) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Resource not found',
      });
    }
    return updated;
  }

  async removeBlockedSlot(
    organizationId: string,
    id: string,
    slotId: string,
  ): Promise<ResourceDocument> {
    const updated = await this.resourcesRepository.removeBlockedSlot(
      organizationId,
      id,
      slotId,
    );
    if (!updated) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Resource not found',
      });
    }
    return updated;
  }
}
