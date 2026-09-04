import { BadRequestException } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import type { ResourcesRepository } from '../resources/resources.repository';
import type { BookingsRepository } from '../bookings/bookings.repository';
import type { OrganizationsService } from '../../organizations/organizations.service';
import type { ResourceDocument } from '../resources/schemas/resource.schema';

const ORG_ID = '507f1f77bcf86cd799439011';
const RESOURCE_ID = '507f1f77bcf86cd799439012';

function buildResource(overrides: Partial<ResourceDocument> = {}) {
  return {
    _id: RESOURCE_ID,
    active: true,
    capacity: 1,
    weeklyAvailability: [],
    blockedSlots: [],
    ...overrides,
  } as unknown as ResourceDocument;
}

function buildService(resource: ResourceDocument, timezone: string) {
  const findById = jest.fn().mockResolvedValue(resource);
  const resourcesRepository = { findById } as unknown as ResourcesRepository;

  const findOverlapping = jest.fn().mockResolvedValue([]);
  const findForResourceOnDay = jest.fn().mockResolvedValue([]);
  const bookingsRepository = {
    findOverlapping,
    findForResourceOnDay,
  } as unknown as BookingsRepository;

  const getById = jest.fn().mockResolvedValue({ timezone });
  const organizationsService = { getById } as unknown as OrganizationsService;

  const resourceModel = { updateOne: jest.fn() } as never;

  const service = new AvailabilityService(
    resourcesRepository,
    bookingsRepository,
    organizationsService,
    resourceModel,
  );
  return { service, findOverlapping };
}

describe('AvailabilityService — timezone-aware weekly windows (ADR-004 fix)', () => {
  // Monday, 2026-01-05 at noon UTC — used only to derive the real day-of-week so the fixture
  // never hardcodes a possibly-wrong weekday.
  const MONDAY_UTC_DAY = new Date('2026-01-05T12:00:00.000Z').getUTCDay();

  it('allows a slot whose UTC instant falls inside the window once converted to the organization local time (the regression case: raw UTC hours previously rejected this)', async () => {
    // 09:00-18:00 window, Europe/Paris (UTC+1 in January, no DST). A booking at 07:00-08:00 UTC
    // is exactly 08:00-09:00 Paris time — under the OLD buggy raw-UTC comparison this was
    // rejected as outside a "09:00-18:00" window; it must now be allowed once actually converted.
    // Use 08:00-09:30 UTC = 09:00-10:30 Paris, safely inside 09:00-18:00.
    const resource = buildResource({
      weeklyAvailability: [
        { dayOfWeek: MONDAY_UTC_DAY, startTime: '09:00', endTime: '18:00' },
      ],
    });
    const { service } = buildService(resource, 'Europe/Paris');

    await expect(
      service.assertSlotAvailable(
        ORG_ID,
        RESOURCE_ID,
        new Date('2026-01-05T08:00:00.000Z'),
        new Date('2026-01-05T09:30:00.000Z'),
      ),
    ).resolves.toBe(resource);
  });

  it('rejects a slot that is genuinely outside the window in the organization local time', async () => {
    // 09:00-18:00 Paris window; 05:00-06:00 UTC = 06:00-07:00 Paris, before the window opens.
    const resource = buildResource({
      weeklyAvailability: [
        { dayOfWeek: MONDAY_UTC_DAY, startTime: '09:00', endTime: '18:00' },
      ],
    });
    const { service } = buildService(resource, 'Europe/Paris');

    await expect(
      service.assertSlotAvailable(
        ORG_ID,
        RESOURCE_ID,
        new Date('2026-01-05T05:00:00.000Z'),
        new Date('2026-01-05T06:00:00.000Z'),
      ),
    ).rejects.toMatchObject({
      response: { code: 'OUTSIDE_AVAILABILITY_WINDOW' },
    });
  });

  it('allows a slot that crosses UTC midnight but stays within one LOCAL calendar day', async () => {
    // Europe/Paris is UTC+1 in January. A 00:30-01:00 Monday-local booking is 23:30 Sunday UTC
    // to 00:00 Monday UTC — two different UTC calendar days, but one single Paris calendar day.
    // The old `isSameUtcDay` check rejected this outright; it must now be allowed.
    const resource = buildResource({
      weeklyAvailability: [
        { dayOfWeek: MONDAY_UTC_DAY, startTime: '00:00', endTime: '02:00' },
      ],
    });
    const { service } = buildService(resource, 'Europe/Paris');

    await expect(
      service.assertSlotAvailable(
        ORG_ID,
        RESOURCE_ID,
        new Date('2026-01-04T23:30:00.000Z'),
        new Date('2026-01-05T00:00:00.000Z'),
      ),
    ).resolves.toBe(resource);
  });

  it('still rejects a slot that genuinely straddles two LOCAL calendar days', async () => {
    const resource = buildResource({
      weeklyAvailability: [
        { dayOfWeek: MONDAY_UTC_DAY, startTime: '00:00', endTime: '23:59' },
        {
          dayOfWeek: (MONDAY_UTC_DAY + 1) % 7,
          startTime: '00:00',
          endTime: '23:59',
        },
      ],
    });
    const { service } = buildService(resource, 'Europe/Paris');

    // 23:00 Monday Paris -> 01:00 Tuesday Paris: a real two-local-day span, must stay rejected.
    await expect(
      service.assertSlotAvailable(
        ORG_ID,
        RESOURCE_ID,
        new Date('2026-01-05T22:00:00.000Z'),
        new Date('2026-01-06T00:00:00.000Z'),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('behaves exactly as before for a UTC-timezone organization (no regression for the common case)', async () => {
    const resource = buildResource({
      weeklyAvailability: [
        { dayOfWeek: MONDAY_UTC_DAY, startTime: '09:00', endTime: '18:00' },
      ],
    });
    const { service } = buildService(resource, 'UTC');

    await expect(
      service.assertSlotAvailable(
        ORG_ID,
        RESOURCE_ID,
        new Date('2026-01-05T10:00:00.000Z'),
        new Date('2026-01-05T11:00:00.000Z'),
      ),
    ).resolves.toBe(resource);

    await expect(
      service.assertSlotAvailable(
        ORG_ID,
        RESOURCE_ID,
        new Date('2026-01-05T20:00:00.000Z'),
        new Date('2026-01-05T21:00:00.000Z'),
      ),
    ).rejects.toMatchObject({
      response: { code: 'OUTSIDE_AVAILABILITY_WINDOW' },
    });
  });
});

describe('AvailabilityService.getDayAvailability — local calendar day resolution', () => {
  it("resolves the requested date's day-of-week and windows using the organization's own timezone, not UTC", async () => {
    // 2026-01-05 is a Monday. For a UTC-11 organization (e.g. Pacific/Midway), "2026-01-05"
    // local spans 2026-01-05T11:00:00Z through 2026-01-06T10:59:00Z in UTC — a naive
    // T00:00:00.000Z/T23:59:59.999Z UTC-day boundary would both mis-set the day-of-week lookup
    // key for a resource whose Monday window is defined in local time, AND miss/include the
    // wrong blocked slots and bookings near the boundary.
    const resource = buildResource({
      weeklyAvailability: [
        { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' },
        { dayOfWeek: 2, startTime: '09:00', endTime: '17:00' },
      ],
    });
    const { service } = buildService(resource, 'Pacific/Midway');

    const result = await service.getDayAvailability(
      ORG_ID,
      RESOURCE_ID,
      '2026-01-05',
    );

    expect(result.windows).toEqual([{ startTime: '09:00', endTime: '17:00' }]);
  });
});
