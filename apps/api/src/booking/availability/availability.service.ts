import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ResourcesRepository } from '../resources/resources.repository';
import { BookingsRepository } from '../bookings/bookings.repository';
import { ResourceDocument } from '../resources/schemas/resource.schema';

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function isSameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/** Times are compared in UTC (see docs/architecture-decisions.md for the known limitation). */
function isWithinWeeklyWindows(
  resource: ResourceDocument,
  startAt: Date,
  endAt: Date,
): boolean {
  if (resource.weeklyAvailability.length === 0) return true;
  if (!isSameUtcDay(startAt, endAt)) return false;

  const dayOfWeek = startAt.getUTCDay();
  const startMinutes = startAt.getUTCHours() * 60 + startAt.getUTCMinutes();
  const endMinutes = endAt.getUTCHours() * 60 + endAt.getUTCMinutes();

  return resource.weeklyAvailability.some(
    (window) =>
      window.dayOfWeek === dayOfWeek &&
      timeToMinutes(window.startTime) <= startMinutes &&
      endMinutes <= timeToMinutes(window.endTime),
  );
}

function overlapsBlockedSlot(
  resource: ResourceDocument,
  startAt: Date,
  endAt: Date,
): boolean {
  return resource.blockedSlots.some(
    (slot) => slot.startAt < endAt && startAt < slot.endAt,
  );
}

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly resourcesRepository: ResourcesRepository,
    private readonly bookingsRepository: BookingsRepository,
  ) {}

  /** Throws if the slot cannot be booked; used by BookingsService before create/reschedule. */
  async assertSlotAvailable(
    organizationId: string,
    resourceId: string,
    startAt: Date,
    endAt: Date,
    excludeBookingId?: string,
  ): Promise<ResourceDocument> {
    const resource = await this.resourcesRepository.findById(
      organizationId,
      resourceId,
    );
    if (!resource) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Resource not found',
      });
    }
    if (!resource.active) {
      throw new BadRequestException({
        code: 'RESOURCE_INACTIVE',
        message: 'This resource is not active',
      });
    }
    if (!isWithinWeeklyWindows(resource, startAt, endAt)) {
      throw new BadRequestException({
        code: 'OUTSIDE_AVAILABILITY_WINDOW',
        message:
          "The requested slot is outside this resource's available hours",
      });
    }
    if (overlapsBlockedSlot(resource, startAt, endAt)) {
      throw new BadRequestException({
        code: 'SLOT_BLOCKED',
        message:
          'The requested slot overlaps a blocked period for this resource',
      });
    }

    const overlapping = await this.bookingsRepository.findOverlapping(
      organizationId,
      resourceId,
      startAt,
      endAt,
      excludeBookingId,
    );
    if (overlapping.length >= resource.capacity) {
      throw new BadRequestException({
        code: 'SLOT_UNAVAILABLE',
        message: 'This resource is fully booked for the requested slot',
      });
    }

    return resource;
  }

  async getDayAvailability(
    organizationId: string,
    resourceId: string,
    date: string,
  ) {
    const resource = await this.resourcesRepository.findById(
      organizationId,
      resourceId,
    );
    if (!resource) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Resource not found',
      });
    }

    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);
    const dayOfWeek = dayStart.getUTCDay();

    const windows = resource.weeklyAvailability
      .filter((w) => w.dayOfWeek === dayOfWeek)
      .map((w) => ({ startTime: w.startTime, endTime: w.endTime }));

    const blockedSlots = resource.blockedSlots
      .filter((slot) => slot.startAt < dayEnd && dayStart < slot.endAt)
      .map((slot) => ({
        id: slot._id?.toString(),
        startAt: slot.startAt.toISOString(),
        endAt: slot.endAt.toISOString(),
        reason: slot.reason,
      }));

    const bookings = (
      await this.bookingsRepository.findForResourceOnDay(
        organizationId,
        resourceId,
        dayStart,
        dayEnd,
      )
    ).map((b) => ({
      startAt: b.startAt.toISOString(),
      endAt: b.endAt.toISOString(),
    }));

    return {
      date,
      windows,
      blockedSlots,
      bookings,
      capacity: resource.capacity,
    };
  }
}
