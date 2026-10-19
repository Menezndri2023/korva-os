import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { ResourcesRepository } from '../resources/resources.repository';
import { BookingsRepository } from '../bookings/bookings.repository';
import { OrganizationsService } from '../../organizations/organizations.service';
import {
  Resource,
  ResourceDocument,
} from '../resources/schemas/resource.schema';

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Spacing between the start times getDaySlots offers. See its doc comment. */
const SLOT_STEP_MINUTES = 30;

const WEEKDAY_TO_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Resolves `date`'s wall-clock day-of-week (0=Sunday, matching Date#getUTCDay's own convention)
 * and minutes-since-midnight AS OBSERVED IN `timeZone` — never in UTC. Fixes ADR-004: `Resource
 * .weeklyAvailability`'s `startTime`/`endTime` ("09:00") are business hours in the organization's
 * own local time, not UTC, so comparing them against a UTC clock silently shifted every
 * organization's hours by its own UTC offset (and, worse, rejected any slot that happened to
 * straddle UTC midnight even when it was nowhere near the organization's actual midnight).
 * `Intl.DateTimeFormat`'s IANA timezone database support is sufficient for this — no
 * date-fns-tz/luxon dependency needed for this direction of the conversion (UTC instant -> local
 * wall-clock parts); DST is handled correctly because the conversion is computed for the specific
 * `date`, not a fixed offset.
 */
function localDateParts(
  date: Date,
  timeZone: string,
): { dayOfWeek: number; minutesOfDay: number; dayKey: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';

  return {
    dayOfWeek: WEEKDAY_TO_INDEX[get('weekday')] ?? date.getUTCDay(),
    minutesOfDay: Number(get('hour')) * 60 + Number(get('minute')),
    dayKey: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

/**
 * Interprets `${dateStr}T${timeStr}` as wall-clock time IN `timeZone` and returns the matching
 * UTC instant — the reverse direction of `localDateParts`, needed by `getDayAvailability` to turn
 * a plain "YYYY-MM-DD" (a calendar day in the organization's own timezone, e.g. what a staff
 * member picks on a date picker) into the correct UTC day-boundary instants. `Intl` has no
 * built-in "local wall-clock -> UTC instant" conversion, so this uses the standard
 * `toLocaleString` round-trip trick: format the same instant in both `timeZone` and UTC, the
 * difference between those two readings IS the UTC offset for that specific date (DST-correct,
 * since it's computed for this exact date rather than a fixed offset).
 */
export function zonedTimeToUtc(
  dateStr: string,
  timeStr: string,
  timeZone: string,
): Date {
  const naiveUtc = new Date(`${dateStr}T${timeStr}:00.000Z`);
  const asZoned = new Date(naiveUtc.toLocaleString('en-US', { timeZone }));
  const asUtc = new Date(naiveUtc.toLocaleString('en-US', { timeZone: 'UTC' }));
  const offsetMs = asUtc.getTime() - asZoned.getTime();
  return new Date(naiveUtc.getTime() + offsetMs);
}

/** Times are compared in the organization's own timezone — see ADR-004 and localDateParts above. */
function isWithinWeeklyWindows(
  resource: ResourceDocument,
  startAt: Date,
  endAt: Date,
  timeZone: string,
): boolean {
  if (resource.weeklyAvailability.length === 0) return true;

  const start = localDateParts(startAt, timeZone);
  const end = localDateParts(endAt, timeZone);
  if (start.dayKey !== end.dayKey) return false;

  return resource.weeklyAvailability.some(
    (window) =>
      window.dayOfWeek === start.dayOfWeek &&
      timeToMinutes(window.startTime) <= start.minutesOfDay &&
      end.minutesOfDay <= timeToMinutes(window.endTime),
  );
}

/** Blocked slots are absolute instants (not wall-clock hours), so plain Date comparison is
 *  already timezone-correct here — no conversion needed, unlike isWithinWeeklyWindows above. */
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
    private readonly organizationsService: OrganizationsService,
    @InjectModel(Resource.name)
    private readonly resourceModel: Model<ResourceDocument>,
  ) {}

  /**
   * Throws if the slot cannot be booked; used by BookingsService before create/reschedule.
   *
   * `session`, when given, ties the overlap read to the caller's MongoDB transaction and, before
   * that read, claims a write on the resource's `bookingLockVersion` counter within that same
   * transaction — see the field's doc comment on the Resource schema for why. Callers that don't
   * pass a session (e.g. reschedule()) get exactly the previous, non-transactional behavior.
   */
  async assertSlotAvailable(
    organizationId: string,
    resourceId: string,
    startAt: Date,
    endAt: Date,
    excludeBookingId?: string,
    session?: ClientSession,
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
    const organization =
      await this.organizationsService.getById(organizationId);
    if (
      !isWithinWeeklyWindows(resource, startAt, endAt, organization.timezone)
    ) {
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

    if (session) {
      // Forces a real MongoDB WriteConflict between any two concurrent booking-creation
      // transactions targeting the same resource: the second writer aborts and
      // session.withTransaction retries it against a fresh snapshot that includes the first
      // writer's now-committed booking, so the capacity check below can never pass twice for
      // the same slot. See bookingLockVersion's doc comment on the Resource schema.
      await this.resourceModel
        .updateOne(
          { _id: resource._id },
          { $inc: { bookingLockVersion: 1 } },
          { session },
        )
        .exec();
    }

    const overlapping = await this.bookingsRepository.findOverlapping(
      organizationId,
      resourceId,
      startAt,
      endAt,
      excludeBookingId,
      session,
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
    const organization =
      await this.organizationsService.getById(organizationId);

    // `date` is a calendar day in the ORGANIZATION's own timezone (what a staff member picks on
    // a date field), so its UTC boundary instants and its day-of-week must be derived from that
    // timezone — not from treating "T00:00:00.000Z" as if the organization were in UTC.
    const dayStart = zonedTimeToUtc(date, '00:00', organization.timezone);
    const dayEnd = zonedTimeToUtc(date, '23:59', organization.timezone);
    const dayOfWeek = localDateParts(dayStart, organization.timezone).dayOfWeek;

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

  /**
   * The start times a customer can actually book on `date` (a calendar day in the organization's
   * own timezone) for a booking lasting `durationMinutes`, as absolute instants plus their local
   * "HH:mm" label.
   *
   * Exists so the storefront never does timezone arithmetic: it used to build `startAt` from the
   * typed hour as if it were UTC, which booked a 14:00 Paris appointment at 16:00. Every rule here
   * mirrors assertSlotAvailable — same window check, same blocked-slot check, same capacity count
   * — so a slot offered here is one create() accepts, barring a race with another customer, which
   * create() still guards against inside its transaction.
   *
   * Candidates start on each window's opening time and step by SLOT_STEP_MINUTES (or by the
   * duration itself when it is shorter), which keeps a 9:00-19:00 day to about twenty choices.
   * A resource with no weekly hours is bookable all day, matching isWithinWeeklyWindows.
   */
  async getDaySlots(
    organizationId: string,
    resourceId: string,
    date: string,
    durationMinutes: number,
    now: Date = new Date(),
  ): Promise<{ startAt: string; endAt: string; time: string }[]> {
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
    if (!resource.active) return [];
    const { timezone } =
      await this.organizationsService.getById(organizationId);

    const dayStart = zonedTimeToUtc(date, '00:00', timezone);
    const dayEnd = zonedTimeToUtc(date, '23:59', timezone);
    const dayOfWeek = localDateParts(dayStart, timezone).dayOfWeek;
    const windows =
      resource.weeklyAvailability.length === 0
        ? [{ startTime: '00:00', endTime: '23:59' }]
        : resource.weeklyAvailability.filter((w) => w.dayOfWeek === dayOfWeek);

    const bookings = await this.bookingsRepository.findForResourceOnDay(
      organizationId,
      resourceId,
      dayStart,
      dayEnd,
    );
    const step = Math.min(SLOT_STEP_MINUTES, durationMinutes);
    const slots: { startAt: string; endAt: string; time: string }[] = [];

    for (const window of windows) {
      const open = timeToMinutes(window.startTime);
      const close = timeToMinutes(window.endTime);
      for (
        let minute = open;
        minute + durationMinutes <= close;
        minute += step
      ) {
        const time = minutesToTime(minute);
        const startAt = zonedTimeToUtc(date, time, timezone);
        const endAt = new Date(startAt.getTime() + durationMinutes * 60_000);
        if (startAt <= now) continue;
        if (!isWithinWeeklyWindows(resource, startAt, endAt, timezone))
          continue;
        if (overlapsBlockedSlot(resource, startAt, endAt)) continue;
        const overlapping = bookings.filter(
          (b) => b.startAt < endAt && startAt < b.endAt,
        ).length;
        if (overlapping >= resource.capacity) continue;
        slots.push({
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          time,
        });
      }
    }
    return slots.sort((a, b) => a.startAt.localeCompare(b.startAt));
  }
}
