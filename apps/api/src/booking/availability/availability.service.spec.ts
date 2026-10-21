import { BadRequestException } from '@nestjs/common';
import { AvailabilityService, nightsBetween } from './availability.service';
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
  return { service, findOverlapping, findForResourceOnDay };
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

describe('AvailabilityService — getDaySlots', () => {
  // 2026-07-06 is a Monday; Paris is UTC+2 in July, Abidjan is UTC+0 all year.
  const DATE = '2026-07-06';
  const MONDAY = new Date('2026-07-06T12:00:00.000Z').getUTCDay();
  const BEFORE_THAT_DAY = new Date('2026-07-01T00:00:00.000Z');

  function mondayResource(
    startTime: string,
    endTime: string,
    overrides: Partial<ResourceDocument> = {},
  ) {
    return buildResource({
      weeklyAvailability: [{ dayOfWeek: MONDAY, startTime, endTime }],
      ...overrides,
    });
  }

  it("labels slots in the organization's local time and returns the matching UTC instants", async () => {
    // The bug this exists to fix: the storefront built startAt from the typed hour as if it were
    // UTC, so a customer choosing 14:00 in a Paris salon was booked at 16:00 Paris.
    const { service } = buildService(
      mondayResource('14:00', '16:00'),
      'Europe/Paris',
    );

    const slots = await service.getDaySlots(
      ORG_ID,
      RESOURCE_ID,
      DATE,
      60,
      BEFORE_THAT_DAY,
    );

    expect(slots).toEqual([
      {
        time: '14:00',
        startAt: '2026-07-06T12:00:00.000Z',
        endAt: '2026-07-06T13:00:00.000Z',
      },
      {
        time: '14:30',
        startAt: '2026-07-06T12:30:00.000Z',
        endAt: '2026-07-06T13:30:00.000Z',
      },
      {
        time: '15:00',
        startAt: '2026-07-06T13:00:00.000Z',
        endAt: '2026-07-06T14:00:00.000Z',
      },
    ]);
  });

  it('is unaffected by the offset in a UTC+0 timezone', async () => {
    const { service } = buildService(
      mondayResource('09:00', '10:00'),
      'Africa/Abidjan',
    );

    const slots = await service.getDaySlots(
      ORG_ID,
      RESOURCE_ID,
      DATE,
      60,
      BEFORE_THAT_DAY,
    );

    expect(slots).toEqual([
      {
        time: '09:00',
        startAt: '2026-07-06T09:00:00.000Z',
        endAt: '2026-07-06T10:00:00.000Z',
      },
    ]);
  });

  it('never offers a slot that would run past the window, and steps by the duration when it is shorter than 30 minutes', async () => {
    const { service } = buildService(
      mondayResource('09:00', '10:00'),
      'Africa/Abidjan',
    );

    const slots = await service.getDaySlots(
      ORG_ID,
      RESOURCE_ID,
      DATE,
      20,
      BEFORE_THAT_DAY,
    );

    expect(slots.map((s) => s.time)).toEqual(['09:00', '09:20', '09:40']);
  });

  it('drops slots taken up to capacity, and keeps them while a place is left', async () => {
    const booking = {
      startAt: new Date('2026-07-06T09:00:00.000Z'),
      endAt: new Date('2026-07-06T10:00:00.000Z'),
    };
    const full = buildService(
      mondayResource('09:00', '11:00'),
      'Africa/Abidjan',
    );
    full.findForResourceOnDay.mockResolvedValue([booking]);
    expect(
      (
        await full.service.getDaySlots(
          ORG_ID,
          RESOURCE_ID,
          DATE,
          60,
          BEFORE_THAT_DAY,
        )
      ).map((s) => s.time),
    ).toEqual(['10:00']);

    const group = buildService(
      mondayResource('09:00', '11:00', { capacity: 2 }),
      'Africa/Abidjan',
    );
    group.findForResourceOnDay.mockResolvedValue([booking]);
    expect(
      (
        await group.service.getDaySlots(
          ORG_ID,
          RESOURCE_ID,
          DATE,
          60,
          BEFORE_THAT_DAY,
        )
      ).map((s) => s.time),
    ).toEqual(['09:00', '09:30', '10:00']);
  });

  it("keeps the resource busy during an existing booking's buffer", async () => {
    const { service, findForResourceOnDay } = buildService(
      mondayResource('09:00', '12:00'),
      'Africa/Abidjan',
    );
    findForResourceOnDay.mockResolvedValue([
      {
        startAt: new Date('2026-07-06T09:00:00.000Z'),
        endAt: new Date('2026-07-06T10:00:00.000Z'),
        // 15 minutes of cleaning after it.
        blockedUntil: new Date('2026-07-06T10:15:00.000Z'),
      },
    ]);

    const slots = await service.getDaySlots(
      ORG_ID,
      RESOURCE_ID,
      DATE,
      60,
      BEFORE_THAT_DAY,
    );

    expect(slots.map((s) => s.time)).toEqual(['10:30', '11:00']);
  });

  it('refuses a slot whose own buffer would run into the next booking', async () => {
    const { service, findForResourceOnDay } = buildService(
      mondayResource('09:00', '12:00'),
      'Africa/Abidjan',
    );
    findForResourceOnDay.mockResolvedValue([
      {
        startAt: new Date('2026-07-06T11:00:00.000Z'),
        endAt: new Date('2026-07-06T12:00:00.000Z'),
      },
    ]);

    // 60 minutes + 30 of buffer: 10:00 would hold the resource until 11:30.
    const slots = await service.getDaySlots(
      ORG_ID,
      RESOURCE_ID,
      DATE,
      60,
      BEFORE_THAT_DAY,
      30,
    );

    expect(slots.map((s) => s.time)).toEqual(['09:00', '09:30']);
  });

  it('drops slots overlapping a blocked period and slots already in the past', async () => {
    const { service } = buildService(
      mondayResource('09:00', '12:00', {
        blockedSlots: [
          {
            startAt: new Date('2026-07-06T10:00:00.000Z'),
            endAt: new Date('2026-07-06T11:00:00.000Z'),
          },
        ] as unknown as ResourceDocument['blockedSlots'],
      }),
      'Africa/Abidjan',
    );

    const slots = await service.getDaySlots(
      ORG_ID,
      RESOURCE_ID,
      DATE,
      60,
      new Date('2026-07-06T09:15:00.000Z'),
    );

    expect(slots.map((s) => s.time)).toEqual(['11:00']);
  });

  it('offers nothing on a day with no opening hours, and nothing for an inactive resource', async () => {
    const closed = buildService(
      buildResource({
        weeklyAvailability: [
          { dayOfWeek: (MONDAY + 1) % 7, startTime: '09:00', endTime: '18:00' },
        ],
      }),
      'Europe/Paris',
    );
    expect(
      await closed.service.getDaySlots(
        ORG_ID,
        RESOURCE_ID,
        DATE,
        60,
        BEFORE_THAT_DAY,
      ),
    ).toEqual([]);

    const inactive = buildService(
      mondayResource('09:00', '18:00', { active: false }),
      'Europe/Paris',
    );
    expect(
      await inactive.service.getDaySlots(
        ORG_ID,
        RESOURCE_ID,
        DATE,
        60,
        BEFORE_THAT_DAY,
      ),
    ).toEqual([]);
  });
});

describe('nightsBetween', () => {
  it('counts calendar nights in the organization timezone, whatever the hours', () => {
    // Monday 15:00 to Wednesday 11:00, Paris (UTC+2 in July): two nights.
    expect(
      nightsBetween(
        new Date('2026-07-06T13:00:00.000Z'),
        new Date('2026-07-08T09:00:00.000Z'),
        'Europe/Paris',
      ),
    ).toBe(2);
  });

  it('is not thrown off by the autumn clock change', () => {
    // Saturday 24 to Monday 26 October 2026, Paris: clocks go back on the 25th.
    expect(
      nightsBetween(
        new Date('2026-10-24T13:00:00.000Z'),
        new Date('2026-10-26T10:00:00.000Z'),
        'Europe/Paris',
      ),
    ).toBe(2);
  });

  it('reads 23:30 UTC as the next day in Abidjan+1 zones, not in UTC', () => {
    // 23:30 UTC on the 6th is 00:30 on the 7th in Lagos (UTC+1).
    expect(
      nightsBetween(
        new Date('2026-07-06T23:30:00.000Z'),
        new Date('2026-07-08T10:00:00.000Z'),
        'Africa/Lagos',
      ),
    ).toBe(1);
  });
});
