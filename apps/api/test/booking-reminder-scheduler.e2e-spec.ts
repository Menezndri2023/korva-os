import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { BookingReminderSchedulerService } from '../src/booking/bookings/booking-reminder-scheduler.service';

interface ApiSuccess<T> {
  success: true;
  data: T;
}

interface AuthPayload {
  accessToken: string;
}
interface OrganizationPayload {
  id: string;
}
interface ContactPayload {
  id: string;
}
interface OfferPayload {
  id: string;
}
interface ResourcePayload {
  id: string;
}
interface BookingPayload {
  id: string;
  reminderSentAt?: string;
  startAt: string;
  endAt: string;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}

// Every day of the week, all day — the reminder sweep looks at "now + a few hours", which can
// land on any weekday depending on when this suite runs, so the resource must always be
// available rather than pinning to one day like most other booking e2e tests do.
const ALL_DAY_EVERY_DAY = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
  dayOfWeek,
  startTime: '00:00',
  endTime: '23:59',
}));

describe('Booking reminder scheduler (e2e)', () => {
  /** The organization's timezone — the one isWithinWeeklyWindows resolves wall-clock hours in. */
  const ORG_TIME_ZONE = 'Europe/Paris';

  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    server = app.getHttpServer();
    connection = app.get(getConnectionToken());
    await connection.dropDatabase();
    await Promise.all(
      connection
        .modelNames()
        .map((name) => connection.model(name).syncIndexes()),
    );
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();
  });

  async function registerOrgContactOfferResource(
    email: string,
    orgName: string,
    contactOverrides: Record<string, unknown> = {},
  ) {
    const authRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email, password: 'password123' })
      .expect(201);
    const accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: orgName,
        type: 'beauté',
        country: 'FR',
        currency: 'EUR',
        // The const, not a second literal: avoidCrossingLocalMidnight resolves wall-clock
        // hours in this same zone, and two copies could drift apart silently.
        timezone: ORG_TIME_ZONE,
        language: 'fr',
      })
      .expect(201);
    const organizationId = asSuccess<OrganizationPayload>(orgRes.body).id;

    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ enabledModules: ['crm', 'catalog', 'booking', 'communication'] })
      .expect(200);

    const contactRes = await request(server)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        firstName: 'Client',
        email: 'client-reminder@korva.test',
        ...contactOverrides,
      })
      .expect(201);
    const contactId = asSuccess<ContactPayload>(contactRes.body).id;

    const offerRes = await request(server)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        type: 'booking',
        name: 'Coupe femme',
        pricing: { amount: 45, currency: 'EUR' },
      })
      .expect(201);
    const offerId = asSuccess<OfferPayload>(offerRes.body).id;

    const resourceRes = await request(server)
      .post('/api/v1/resources')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        name: 'Sophie',
        type: 'person',
        capacity: 1,
        weeklyAvailability: ALL_DAY_EVERY_DAY,
      })
      .expect(201);
    const resourceId = asSuccess<ResourcePayload>(resourceRes.body).id;

    return { accessToken, organizationId, contactId, offerId, resourceId };
  }

  /**
   * Pulls a start time back out of the last hour of the local day.
   *
   * WHY. `isWithinWeeklyWindows` (availability.service.ts) opens with
   * `if (start.dayKey !== end.dayKey) return false` — a booking may not cross local midnight,
   * whatever the resource's window says, because weekly availability is expressed per day. The
   * resource here is open 00:00-23:59 every day, so the only way to fail it is to straddle
   * midnight: a one-hour booking starting at 23:xx ends on the following day.
   *
   * `Date.now() + N hours` lands there for two hours out of every twenty-four, which made this
   * suite fail roughly 8% of runs for reasons having nothing to do with reminders. It failed in
   * CI at 20:44 Paris (the +3h booking reaching 23:44) and locally at 23:45 Paris (the +48h one,
   * since +48h preserves the hour) — two arms of the same cause, which is why it looked like an
   * environmental flake the first time.
   *
   * Pushing FORWARD 2 hours lands a 23:xx start at 01:xx the next day: no midnight crossed,
   * `+2h`/`+3h` stay well inside the 24h reminder window, and `+48h` becomes 50h, still outside
   * it — so no assertion changes meaning. Shifting rather than skipping, so the test runs at
   * every hour of the day.
   *
   * It used to pull BACK 2 hours, which turned a `+2h` booking into one starting right now: by
   * the time the sweep ran it was already in the past and was never reminded. CI hit exactly
   * that at 21:38 Paris on 2026-10-20 (+2h = 23:38, minus 2h = now).
   */
  function avoidCrossingLocalMidnight(startAt: Date): Date {
    const localHour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: ORG_TIME_ZONE,
        hour: 'numeric',
        hour12: false,
      }).format(startAt),
    );
    return localHour === 23
      ? new Date(startAt.getTime() + 2 * 60 * 60 * 1000)
      : startAt;
  }

  async function createBookingInHours(
    accessToken: string,
    organizationId: string,
    resourceId: string,
    offerId: string,
    contactId: string,
    hoursFromNow: number,
  ): Promise<BookingPayload> {
    const startAt = avoidCrossingLocalMidnight(
      new Date(Date.now() + hoursFromNow * 60 * 60 * 1000),
    );
    const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
    const res = await request(server)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        resourceId,
        offerId,
        contactId,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
      })
      .expect(201);
    return asSuccess<BookingPayload>(res.body);
  }

  async function getBooking(
    accessToken: string,
    organizationId: string,
    bookingId: string,
  ): Promise<BookingPayload> {
    const res = await request(server)
      .get(`/api/v1/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    return asSuccess<BookingPayload>(res.body);
  }

  it('sends a reminder (falling back to email, no WhatsApp consent on file) for a booking within the window, and marks it reminded', async () => {
    const { accessToken, organizationId, contactId, offerId, resourceId } =
      await registerOrgContactOfferResource(
        'reminder-owner@korva.test',
        'Reminder Org',
      );
    const booking = await createBookingInHours(
      accessToken,
      organizationId,
      resourceId,
      offerId,
      contactId,
      2, // within the default 24h window
    );

    await app.get(BookingReminderSchedulerService).runSweep();

    const afterSweep = await getBooking(
      accessToken,
      organizationId,
      booking.id,
    );
    expect(afterSweep.reminderSentAt).toBeDefined();

    const conversationsRes = await request(server)
      .get('/api/v1/conversations')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    const conversations = asSuccess<{ channel: string; contactId: string }[]>(
      conversationsRes.body,
    );
    expect(
      conversations.some(
        (c) => c.channel === 'email' && c.contactId === contactId,
      ),
    ).toBe(true);
  });

  it('does not re-process a booking already reminded, or one outside the window', async () => {
    const { accessToken, organizationId, contactId, offerId, resourceId } =
      await registerOrgContactOfferResource(
        'reminder-idempotent-owner@korva.test',
        'Reminder Idempotent Org',
      );
    const inWindow = await createBookingInHours(
      accessToken,
      organizationId,
      resourceId,
      offerId,
      contactId,
      3,
    );
    const outsideWindow = await createBookingInHours(
      accessToken,
      organizationId,
      resourceId,
      offerId,
      contactId,
      48, // beyond the default 24h window
    );

    const scheduler = app.get(BookingReminderSchedulerService);
    await scheduler.runSweep();
    const firstPass = await getBooking(
      accessToken,
      organizationId,
      inWindow.id,
    );
    expect(firstPass.reminderSentAt).toBeDefined();
    const firstReminderTimestamp = firstPass.reminderSentAt;

    const outsideAfterFirstSweep = await getBooking(
      accessToken,
      organizationId,
      outsideWindow.id,
    );
    expect(outsideAfterFirstSweep.reminderSentAt).toBeUndefined();

    // A second sweep must not re-send for the already-reminded booking.
    await scheduler.runSweep();
    const secondPass = await getBooking(
      accessToken,
      organizationId,
      inWindow.id,
    );
    expect(secondPass.reminderSentAt).toBe(firstReminderTimestamp);
  });

  it('clears reminderSentAt on reschedule, so the new time becomes eligible again', async () => {
    const { accessToken, organizationId, contactId, offerId, resourceId } =
      await registerOrgContactOfferResource(
        'reminder-reschedule-owner@korva.test',
        'Reminder Reschedule Org',
      );
    const booking = await createBookingInHours(
      accessToken,
      organizationId,
      resourceId,
      offerId,
      contactId,
      2,
    );

    const scheduler = app.get(BookingReminderSchedulerService);
    await scheduler.runSweep();
    const reminded = await getBooking(accessToken, organizationId, booking.id);
    expect(reminded.reminderSentAt).toBeDefined();

    // Through the same guard as createBookingInHours: this was the one booking time in the file
    // that bypassed it, and it failed CI at 18:18 Paris (+5h = 23:18, ending past midnight).
    // Shifted, it lands at +7h — still inside the 24h reminder window, so the re-sweep below
    // keeps its meaning.
    const newStartAt = avoidCrossingLocalMidnight(
      new Date(Date.now() + 5 * 60 * 60 * 1000),
    );
    const newEndAt = new Date(newStartAt.getTime() + 60 * 60 * 1000);
    const rescheduleRes = await request(server)
      .post(`/api/v1/bookings/${booking.id}/reschedule`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        startAt: newStartAt.toISOString(),
        endAt: newEndAt.toISOString(),
      })
      .expect(201);
    expect(
      asSuccess<BookingPayload>(rescheduleRes.body).reminderSentAt,
    ).toBeUndefined();

    await scheduler.runSweep();
    const remindedAgain = await getBooking(
      accessToken,
      organizationId,
      booking.id,
    );
    expect(remindedAgain.reminderSentAt).toBeDefined();
  });
});
