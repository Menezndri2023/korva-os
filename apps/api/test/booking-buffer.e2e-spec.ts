import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

/**
 * Buffer time after a slot (Offer.bufferMinutes): the resource stays busy until
 * Booking.blockedUntil, for the slots the storefront offers and for the bookings the API
 * accepts. Abidjan (UTC+0 all year) keeps the times readable. Standalone, one registration.
 */

interface ApiSuccess<T> {
  success: true;
  data: T;
}
interface ApiError {
  success: false;
  error: { code: string; message: string };
}
function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

function nextMonday(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 7);
  while (date.getUTCDay() !== 1) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

describe('Booking buffer time (e2e)', () => {
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

  it('keeps the resource busy for the buffer after each booking, and moves it on reschedule', async () => {
    const monday = nextMonday();
    const authRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email: 'buffer-owner@korva.test', password: 'password123' })
      .expect(201);
    const accessToken = asSuccess<{ accessToken: string }>(
      authRes.body,
    ).accessToken;
    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Spa Tampon',
        type: 'beauté',
        country: 'CI',
        currency: 'XOF',
        timezone: 'Africa/Abidjan',
        language: 'fr',
      })
      .expect(201);
    const { id: organizationId, slug } = asSuccess<{
      id: string;
      slug: string;
    }>(orgRes.body);
    const auth = (req: request.Test) =>
      req
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId);

    const resourceId = asSuccess<{ id: string }>(
      (
        await auth(request(server).post('/api/v1/resources'))
          .send({
            name: 'Cabine',
            type: 'room',
            weeklyAvailability: [
              { dayOfWeek: 1, startTime: '09:00', endTime: '13:00' },
            ],
          })
          .expect(201)
      ).body,
    ).id;
    const offerId = asSuccess<{ id: string }>(
      (
        await auth(request(server).post('/api/v1/offers'))
          .send({
            type: 'booking',
            name: 'Massage',
            status: 'active',
            durationMinutes: 60,
            bufferMinutes: 30,
            pricing: { amount: 15000, currency: 'XOF' },
          })
          .expect(201)
      ).body,
    ).id;
    const contactId = asSuccess<{ id: string }>(
      (
        await auth(request(server).post('/api/v1/contacts'))
          .send({ firstName: 'Awa' })
          .expect(201)
      ).body,
    ).id;

    const book = (start: string, end: string) =>
      auth(request(server).post('/api/v1/bookings')).send({
        resourceId,
        offerId,
        contactId,
        startAt: `${monday}T${start}:00.000Z`,
        endAt: `${monday}T${end}:00.000Z`,
      });
    const slotTimes = async () =>
      asSuccess<{ slots: { time: string }[] }>(
        (
          await request(server)
            .get(
              `/api/v1/public/${slug}/slots?resourceId=${resourceId}&offerId=${offerId}&date=${monday}`,
            )
            .expect(200)
        ).body,
      ).slots.map((slot) => slot.time);

    const first = asSuccess<{ id: string; blockedUntil: string }>(
      (await book('09:00', '10:00').expect(201)).body,
    );
    expect(first.blockedUntil).toBe(`${monday}T10:30:00.000Z`);

    // 10:00 falls inside the buffer; 10:30 is the first time the cabin is free. 12:00 is still
    // offered: the massage itself ends at 13:00, closing time, and a buffer may run past closing
    // (opening hours are checked against the real end, not the buffer).
    expect(await slotTimes()).toEqual(['10:30', '11:00', '11:30', '12:00']);
    const inside = await book('10:00', '11:00').expect(400);
    expect(asError(inside.body).code).toBe('SLOT_UNAVAILABLE');
    await book('10:30', '11:30').expect(201);

    // Rescheduling is checked against buffers too: 11:30 is inside the second booking's
    // buffer (10:30-11:30, then busy until 12:00)...
    await auth(request(server).post(`/api/v1/bookings/${first.id}/reschedule`))
      .send({
        startAt: `${monday}T11:30:00.000Z`,
        endAt: `${monday}T12:30:00.000Z`,
      })
      .expect(400);
    // ...and 12:00 is free; the booking's own buffer moves with it.
    const moved = asSuccess<{ blockedUntil: string }>(
      (
        await auth(
          request(server).post(`/api/v1/bookings/${first.id}/reschedule`),
        )
          .send({
            startAt: `${monday}T12:00:00.000Z`,
            endAt: `${monday}T13:00:00.000Z`,
          })
          .expect(201)
      ).body,
    );
    expect(moved.blockedUntil).toBe(`${monday}T13:30:00.000Z`);
  });
});
