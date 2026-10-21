import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { putOrganizationOnPlan } from './support/plan-tier';

/**
 * Table booking: GET /public/:slug/table-slots and a public booking by party size, where the API
 * assigns the smallest free table that seats the party (PublicService#bookAnyTable).
 *
 * Its own file because the public-booking throttle (PUBLIC_BOOKING_THROTTLE) is counted per app
 * instance, and public-booking-slots.e2e-spec.ts already spends most of it. The small helpers
 * below are copied from that file.
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

function nextMonday(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 7);
  while (date.getUTCDay() !== 1) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}

describe('Public table booking (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  let accessToken: string;
  let organizationId: string;
  let slug: string;
  const monday = nextMonday();

  function auth(req: request.Test) {
    return req
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId);
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
      .send({ email: 'tables-owner@korva.test', password: 'password123' })
      .expect(201);
    accessToken = asSuccess<{ accessToken: string }>(authRes.body).accessToken;
    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Maquis des Tables',
        type: 'restauration',
        country: 'FR',
        currency: 'EUR',
        timezone: TIME_ZONE,
        language: 'fr',
      })
      .expect(201);
    ({ id: organizationId, slug } = asSuccess<{ id: string; slug: string }>(
      orgRes.body,
    ));
    // A restaurant on Free gets orders; table booking needs the booking module, which is the
    // second channel — a paid feature (PLAN_FEATURE_MIN_PLAN.both_channels).
    await putOrganizationOnPlan(connection, organizationId, 'starter');
    await auth(request(server).patch('/api/v1/organizations/me'))
      .send({
        enabledModules: ['catalog', 'booking', 'commerce', 'crm', 'website'],
      })
      .expect(200);
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();
  });

  it('books a table by party size, assigning the smallest free table that seats it', async () => {
    const table = async (name: string, seats: number) =>
      asSuccess<{ id: string }>(
        (
          await auth(request(server).post('/api/v1/resources'))
            .send({
              name,
              type: 'room',
              seats,
              weeklyAvailability: [
                { dayOfWeek: 1, startTime: '12:00', endTime: '15:00' },
              ],
            })
            .expect(201)
        ).body,
      ).id;
    const twoSeats = await table('Table 1', 2);
    const sixSeats = await table('Table 2', 6);
    const offerRes = await auth(request(server).post('/api/v1/offers'))
      .send({
        type: 'booking',
        name: 'Table au déjeuner',
        status: 'active',
        durationMinutes: 90,
        pricing: { amount: 0, currency: 'EUR' },
      })
      .expect(201);
    const tableOfferId = asSuccess<{ id: string }>(offerRes.body).id;

    const slotsFor = async (partySize: number) =>
      asSuccess<SlotsPayload>(
        (
          await request(server)
            .get(
              `/api/v1/public/${slug}/table-slots?offerId=${tableOfferId}&date=${monday}&partySize=${partySize}`,
            )
            .expect(200)
        ).body,
      ).slots;
    const [noon] = await slotsFor(4);
    expect(noon!.time).toBe('12:00');
    expect(await slotsFor(8)).toEqual([]);

    const book = (partySize: number, email: string) =>
      request(server).post(`/api/v1/public/${slug}/bookings`).send({
        offerId: tableOfferId,
        partySize,
        startAt: noon!.startAt,
        endAt: noon!.endAt,
        contact: { email },
      });

    // Four guests only fit the six-seat table.
    const four = asSuccess<{ id: string }>(
      (await book(4, 'a@customer.test').expect(201)).body,
    );
    const fourBooking = asSuccess<{ resourceId: string; partySize: number }>(
      (
        await auth(request(server).get(`/api/v1/bookings/${four.id}`)).expect(
          200,
        )
      ).body,
    );
    expect(fourBooking).toMatchObject({ resourceId: sixSeats, partySize: 4 });

    // A second party of four at noon finds no table; a party of two gets the small one.
    const full = await book(4, 'b@customer.test').expect(400);
    expect(asError(full.body).code).toBe('NO_TABLE_AVAILABLE');
    const two = asSuccess<{ id: string }>(
      (await book(2, 'c@customer.test').expect(201)).body,
    );
    expect(
      asSuccess<{ resourceId: string }>(
        (
          await auth(request(server).get(`/api/v1/bookings/${two.id}`)).expect(
            200,
          )
        ).body,
      ).resourceId,
    ).toBe(twoSeats);

    // Noon is now gone for any party size at all.
    expect((await slotsFor(2)).map((slot) => slot.time)).not.toContain('12:00');
  });
});
