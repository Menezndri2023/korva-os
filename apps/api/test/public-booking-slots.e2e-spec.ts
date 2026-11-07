import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

/**
 * Fixed-duration offers and server-computed slots (GET /public/:slug/slots).
 *
 * Standalone file, one registration: public.e2e-spec.ts already sits close to the per-file
 * AUTH_THROTTLE budget.
 *
 * What this proves end to end:
 *  - an offer carries its own duration and the API keeps it;
 *  - slots are labelled in the ORGANIZATION's local time (Europe/Paris here) — the storefront used
 *    to build startAt from the typed hour as if it were UTC;
 *  - a public booking of a fixed-duration offer lasts exactly that duration, whatever endAt the
 *    client sends;
 *  - a booked slot disappears from the next listing.
 */

interface ApiSuccess<T> {
  success: true;
  data: T;
}
interface ApiError {
  success: false;
  error: { code: string; message: string };
}
interface Slot {
  startAt: string;
  endAt: string;
  time: string;
}
interface SlotsPayload {
  date: string;
  durationMinutes: number;
  slots: Slot[];
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

const TIME_ZONE = 'Europe/Paris';

/** "HH:mm" of an instant as read on a wall clock in Paris. */
function parisTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

function nextMonday(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 7);
  while (date.getUTCDay() !== 1) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}

describe('Public booking slots and fixed-duration offers (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;

  let accessToken: string;
  let organizationId: string;
  let slug: string;
  let resourceId: string;
  let fixedOfferId: string;
  let openOfferId: string;
  const monday = nextMonday();

  function auth(req: request.Test) {
    return req
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId);
  }

  async function getSlots(query: string): Promise<SlotsPayload> {
    const res = await request(server)
      .get(`/api/v1/public/${slug}/slots?${query}`)
      .expect(200);
    return asSuccess<SlotsPayload>(res.body);
  }

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

    const authRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email: 'slots-owner@korva.test', password: 'password123' })
      .expect(201);
    accessToken = asSuccess<{ accessToken: string }>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Salon Slots',
        type: 'beauté',
        country: 'FR',
        currency: 'EUR',
        timezone: TIME_ZONE,
        language: 'fr',
      })
      .expect(201);
    ({ id: organizationId, slug } = asSuccess<{ id: string; slug: string }>(
      orgRes.body,
    ));
    await auth(request(server).patch('/api/v1/organizations/me'))
      .send({ enabledModules: ['catalog', 'booking', 'crm', 'website'] })
      .expect(200);

    const resourceRes = await auth(request(server).post('/api/v1/resources'))
      .send({
        name: 'Fauteuil 1',
        type: 'chair',
        weeklyAvailability: [
          { dayOfWeek: 1, startTime: '09:00', endTime: '11:00' },
        ],
      })
      .expect(201);
    resourceId = asSuccess<{ id: string }>(resourceRes.body).id;

    const fixedRes = await auth(request(server).post('/api/v1/offers'))
      .send({
        type: 'booking',
        name: 'Coupe femme',
        status: 'active',
        durationMinutes: 45,
        pricing: { amount: 35, currency: 'EUR' },
      })
      .expect(201);
    fixedOfferId = asSuccess<{ id: string }>(fixedRes.body).id;

    const openRes = await auth(request(server).post('/api/v1/offers'))
      .send({
        type: 'booking',
        name: 'Location du studio',
        status: 'active',
        pricing: { amount: 20, currency: 'EUR' },
      })
      .expect(201);
    openOfferId = asSuccess<{ id: string }>(openRes.body).id;
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();
  });

  it('keeps the duration on the offer, privately and publicly', async () => {
    const privateRes = await auth(
      request(server).get(`/api/v1/offers/${fixedOfferId}`),
    ).expect(200);
    expect(
      asSuccess<{ durationMinutes?: number }>(privateRes.body).durationMinutes,
    ).toBe(45);

    const publicRes = await request(server)
      .get(`/api/v1/public/${slug}/offers/${fixedOfferId}`)
      .expect(200);
    expect(
      asSuccess<{ durationMinutes?: number }>(publicRes.body).durationMinutes,
    ).toBe(45);
  });

  it("offers slots of the offer's own length, labelled in the organization's local time", async () => {
    // durationMinutes=120 in the query is ignored: the offer's 45 minutes win.
    const payload = await getSlots(
      `resourceId=${resourceId}&offerId=${fixedOfferId}&date=${monday}&durationMinutes=120`,
    );

    expect(payload.durationMinutes).toBe(45);
    expect(payload.slots.map((s) => s.time)).toEqual([
      '09:00',
      '09:30',
      '10:00',
    ]);
    for (const slot of payload.slots) {
      // The label and the instant agree in Paris, whatever the UTC offset is that week.
      expect(parisTime(slot.startAt)).toBe(slot.time);
      expect(
        new Date(slot.endAt).getTime() - new Date(slot.startAt).getTime(),
      ).toBe(45 * 60_000);
    }
  });

  it("books exactly the offer's duration whatever endAt the client sends, and the slot then disappears", async () => {
    const [first] = (
      await getSlots(
        `resourceId=${resourceId}&offerId=${fixedOfferId}&date=${monday}`,
      )
    ).slots;

    const bookingRes = await request(server)
      .post(`/api/v1/public/${slug}/bookings`)
      .send({
        resourceId,
        offerId: fixedOfferId,
        startAt: first!.startAt,
        // A client asking for 5 minutes of a 45-minute service.
        endAt: new Date(
          new Date(first!.startAt).getTime() + 5 * 60_000,
        ).toISOString(),
        contact: { email: 'cliente@customer.test', firstName: 'Awa' },
      })
      .expect(201);
    const booking = asSuccess<{ startAt: string; endAt: string }>(
      bookingRes.body,
    );
    expect(new Date(booking.endAt).toISOString()).toBe(first!.endAt);

    // 09:00-09:45 is taken: 09:00 and 09:30 overlap it, 10:00 does not.
    const after = await getSlots(
      `resourceId=${resourceId}&offerId=${fixedOfferId}&date=${monday}`,
    );
    expect(after.slots.map((s) => s.time)).toEqual(['10:00']);
  });

  it('lets the visitor pick the length for an offer that has none', async () => {
    const payload = await getSlots(
      `resourceId=${resourceId}&offerId=${openOfferId}&date=${monday}&durationMinutes=60`,
    );

    expect(payload.durationMinutes).toBe(60);
    // 09:00-09:45 is booked by the previous test; 10:00-11:00 is the only free hour.
    expect(payload.slots.map((s) => s.time)).toEqual(['10:00']);
  });

  it('never exposes slots for an offer that is not for sale', async () => {
    const draftRes = await auth(request(server).post('/api/v1/offers'))
      .send({
        type: 'booking',
        name: 'Brouillon',
        durationMinutes: 30,
        pricing: { amount: 10, currency: 'EUR' },
      })
      .expect(201);
    const draftId = asSuccess<{ id: string }>(draftRes.body).id;

    const res = await request(server)
      .get(
        `/api/v1/public/${slug}/slots?resourceId=${resourceId}&offerId=${draftId}&date=${monday}`,
      )
      .expect(404);
    expect(asError(res.body).code).toBe('OFFER_NOT_FOUND');
  });

  it('publishes a team member with photo and presentation, needing no user account', async () => {
    await auth(request(server).post('/api/v1/resources'))
      .send({
        name: 'Awa',
        type: 'person',
        description: 'Coloriste',
        photo: 'https://example.com/awa.png',
        weeklyAvailability: [
          { dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },
        ],
      })
      .expect(201);

    const res = await request(server)
      .get(`/api/v1/public/${slug}/resources`)
      .expect(200);
    const awa = asSuccess<
      { name: string; type: string; description?: string; photo?: string }[]
    >(res.body).find((resource) => resource.name === 'Awa');
    expect(awa).toMatchObject({
      type: 'person',
      description: 'Coloriste',
      photo: 'https://example.com/awa.png',
    });
  });

  it('books a stay by the night: quoted, priced per night, at the check-in and check-out times, never twice', async () => {
    const roomRes = await auth(request(server).post('/api/v1/resources'))
      .send({ name: 'Chambre Baobab', type: 'room' })
      .expect(201);
    const roomId = asSuccess<{ id: string }>(roomRes.body).id;
    const stayRes = await auth(request(server).post('/api/v1/offers'))
      .send({
        type: 'booking',
        name: 'Nuitée',
        status: 'active',
        bookingUnit: 'night',
        minNights: 2,
        pricing: { amount: 60, currency: 'EUR' },
      })
      .expect(201);
    const stayOfferId = asSuccess<{ id: string }>(stayRes.body).id;

    const day = (offset: number) => {
      const date = new Date(`${monday}T12:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + offset);
      return date.toISOString().slice(0, 10);
    };
    const quote = async (checkIn: string, checkOut: string) =>
      asSuccess<{
        nights: number;
        total: number;
        available: boolean;
        reason: string | null;
      }>(
        (
          await request(server)
            .get(
              `/api/v1/public/${slug}/stay-quote?offerId=${stayOfferId}&resourceId=${roomId}&checkIn=${checkIn}&checkOut=${checkOut}`,
            )
            .expect(200)
        ).body,
      );

    expect(await quote(day(0), day(1))).toMatchObject({
      nights: 1,
      available: false,
      reason: 'STAY_BELOW_MINIMUM',
    });
    expect(await quote(day(0), day(3))).toMatchObject({
      nights: 3,
      total: 180,
      available: true,
    });

    const bookingRes = await request(server)
      .post(`/api/v1/public/${slug}/bookings`)
      .send({
        resourceId: roomId,
        offerId: stayOfferId,
        checkIn: day(0),
        checkOut: day(3),
        contact: { email: 'voyageur@customer.test' },
      })
      .expect(201);
    const booking = asSuccess<{ id: string; startAt: string; endAt: string }>(
      bookingRes.body,
    );
    // 15:00 on arrival and 11:00 on departure, read on the Paris clock.
    expect(parisTime(booking.startAt)).toBe('15:00');
    expect(parisTime(booking.endAt)).toBe('11:00');

    const stored = asSuccess<{ nights: number; pricing: { amount: number } }>(
      (
        await auth(
          request(server).get(`/api/v1/bookings/${booking.id}`),
        ).expect(200)
      ).body,
    );
    expect(stored).toMatchObject({ nights: 3, pricing: { amount: 180 } });

    // The room is taken for those nights; departing the day someone else arrives is fine.
    expect(await quote(day(1), day(4))).toMatchObject({ available: false });
    expect(await quote(day(3), day(5))).toMatchObject({ available: true });
    await request(server)
      .post(`/api/v1/public/${slug}/bookings`)
      .send({
        resourceId: roomId,
        offerId: stayOfferId,
        checkIn: day(2),
        checkOut: day(4),
        contact: { email: 'autre@customer.test' },
      })
      .expect(400);
  });

  it('rejects a duration outside the allowed bounds', async () => {
    await auth(request(server).patch(`/api/v1/offers/${fixedOfferId}`))
      .send({ durationMinutes: 2 })
      .expect(400);
    await auth(request(server).patch(`/api/v1/offers/${fixedOfferId}`))
      .send({ durationMinutes: 24 * 60 })
      .expect(400);
  });

  it('offers and books slots past midnight for opening hours that run into the next day', async () => {
    // A bar open Monday 20:00 → 02:00 (Paris time).
    const bar = asSuccess<{ id: string }>(
      (
        await auth(request(server).post('/api/v1/resources'))
          .send({
            name: 'Table du soir',
            type: 'room',
            weeklyAvailability: [
              { dayOfWeek: 1, startTime: '20:00', endTime: '02:00' },
            ],
          })
          .expect(201)
      ).body,
    ).id;
    const offer = asSuccess<{ id: string }>(
      (
        await auth(request(server).post('/api/v1/offers'))
          .send({
            type: 'booking',
            name: 'Soirée',
            status: 'active',
            durationMinutes: 60,
            pricing: { amount: 15, currency: 'EUR' },
          })
          .expect(201)
      ).body,
    ).id;
    const { slots } = await getSlots(
      `resourceId=${bar}&offerId=${offer}&date=${monday}`,
    );
    const times = slots.map((slot) => slot.time);
    expect(times[0]).toBe('20:00');
    expect(times).toContain('00:30');
    expect(times[times.length - 1]).toBe('01:00');
    const lateSlot = slots.find((slot) => slot.time === '00:30')!;
    // 00:30 is the next calendar day: one hour after 23:30, not twenty-three before it.
    const elevenThirty = slots.find((slot) => slot.time === '23:30')!;
    expect(
      new Date(lateSlot.startAt).getTime() -
        new Date(elevenThirty.startAt).getTime(),
    ).toBe(60 * 60 * 1000);

    // A booking across midnight is accepted; one after closing is not.
    const across = slots.find((slot) => slot.time === '23:30')!;
    await request(server)
      .post(`/api/v1/public/${slug}/bookings`)
      .send({
        resourceId: bar,
        offerId: offer,
        startAt: across.startAt,
        endAt: across.endAt,
        contact: { email: 'nuit@customer.test', firstName: 'Kofi' },
      })
      .expect(201);
    const afterClosing = new Date(
      new Date(lateSlot.startAt).getTime() + 2 * 60 * 60 * 1000,
    );
    await request(server)
      .post(`/api/v1/public/${slug}/bookings`)
      .send({
        resourceId: bar,
        offerId: offer,
        startAt: afterClosing.toISOString(),
        endAt: new Date(afterClosing.getTime() + 60 * 60 * 1000).toISOString(),
        contact: { email: 'trop-tard@customer.test', firstName: 'Ama' },
      })
      .expect(400);
  });
});
