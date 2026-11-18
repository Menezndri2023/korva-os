import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { putOrganizationOnPlan } from './support/plan-tier';

/**
 * Free cancellation (Offer.cancellationHours): the customer cancels their own booking from their
 * account until N hours before it starts — never past that deadline, never on an offer with no
 * such policy, never someone else's booking. The booking then records who cancelled it.
 */

interface ApiSuccess<T> {
  success: true;
  data: T;
}
interface ApiError {
  success: false;
  error: { code: string; message: string };
}
const asSuccess = <T>(body: unknown) => (body as ApiSuccess<T>).data;
const asError = (body: unknown) => (body as ApiError).error;

function nextMonday(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 7);
  while (date.getUTCDay() !== 1) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

describe('Booking customer cancellation (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  let slug: string;
  let offerId: string;
  let staff: (req: request.Test) => request.Test;
  let customerToken: string;
  let otherToken: string;
  let firstId: string;
  let secondId: string;
  const monday = nextMonday();

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

    const token = asSuccess<{ accessToken: string }>(
      (
        await request(server)
          .post('/api/v1/auth/register')
          .send({ email: 'owner@salon-annulation.ci', password: 'password123' })
          .expect(201)
      ).body,
    ).accessToken;
    const org = asSuccess<{ id: string; slug: string }>(
      (
        await request(server)
          .post('/api/v1/organizations')
          .set('Authorization', `Bearer ${token}`)
          .send({
            name: 'Salon Annulation',
            type: 'beauté',
            country: 'CI',
            currency: 'XOF',
            timezone: 'Africa/Abidjan',
            language: 'fr',
          })
          .expect(201)
      ).body,
    );
    slug = org.slug;
    // Customer accounts are a paid feature — scaffolding here, not what is tested.
    await putOrganizationOnPlan(connection, org.id, 'starter');
    staff = (req) =>
      req
        .set('Authorization', `Bearer ${token}`)
        .set('X-Organization-Id', org.id);
    await staff(request(server).patch('/api/v1/organizations/me'))
      .send({ enabledModules: ['crm', 'catalog', 'booking', 'website'] })
      .expect(200);
    const resourceId = asSuccess<{ id: string }>(
      (
        await staff(request(server).post('/api/v1/resources'))
          .send({
            name: 'Fauteuil 1',
            type: 'chair',
            weeklyAvailability: [
              { dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },
            ],
          })
          .expect(201)
      ).body,
    ).id;
    offerId = asSuccess<{ id: string }>(
      (
        await staff(request(server).post('/api/v1/offers'))
          .send({
            type: 'booking',
            name: 'Tresses africaines',
            status: 'active',
            durationMinutes: 60,
            cancellationHours: 24,
            pricing: { amount: 10000, currency: 'XOF' },
          })
          .expect(201)
      ).body,
    ).id;

    const book = async (hour: string) =>
      asSuccess<{ id: string }>(
        (
          await request(server)
            .post(`/api/v1/public/${slug}/bookings`)
            .send({
              resourceId,
              offerId,
              startAt: `${monday}T${hour}:00:00.000Z`,
              endAt: `${monday}T${String(Number(hour) + 1).padStart(2, '0')}:00:00.000Z`,
              contact: { email: 'cliente@annulation.ci', firstName: 'Awa' },
            })
            .expect(201)
        ).body,
      ).id;
    firstId = await book('09');
    secondId = await book('11');

    const register = async (email: string) =>
      asSuccess<{ accessToken: string }>(
        (
          await request(server)
            .post(`/api/v1/public/${slug}/account/register`)
            .send({ email, password: 'clientpass123' })
            .expect(201)
        ).body,
      ).accessToken;
    customerToken = await register('cliente@annulation.ci');
    otherToken = await register('autre@annulation.ci');
  }, 120_000);

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();
  });

  const detail = (id: string, as = customerToken) =>
    request(server)
      .get(`/api/v1/public/${slug}/account/bookings/${id}`)
      .set('Authorization', `Bearer ${as}`);
  const cancel = (id: string, as = customerToken) =>
    request(server)
      .post(`/api/v1/public/${slug}/account/bookings/${id}/cancel`)
      .set('Authorization', `Bearer ${as}`);

  it('shows the policy on the public offer and the deadline on the booking', async () => {
    const offer = await request(server)
      .get(`/api/v1/public/${slug}/offers/${offerId}`)
      .expect(200);
    expect(
      asSuccess<{ cancellationHours?: number }>(offer.body).cancellationHours,
    ).toBe(24);

    const res = await detail(firstId).expect(200);
    const booking = asSuccess<{
      cancellationHours?: number;
      cancellableUntil?: string;
    }>(res.body);
    expect(booking.cancellationHours).toBe(24);
    expect(new Date(booking.cancellableUntil!).toISOString()).toBe(
      new Date(
        new Date(`${monday}T09:00:00.000Z`).getTime() - 24 * 3_600_000,
      ).toISOString(),
    );
  });

  it("never lets a customer cancel someone else's booking", async () => {
    const res = await cancel(firstId, otherToken).expect(404);
    expect(asError(res.body).code).toBe('BOOKING_NOT_FOUND');
  });

  it('cancels within the window and records that the customer did it', async () => {
    const res = await cancel(firstId).expect(201);
    expect(asSuccess<{ status: string }>(res.body).status).toBe('cancelled');

    const booking = asSuccess<{ status: string; cancelledBy?: string }>(
      (
        await staff(request(server).get(`/api/v1/bookings/${firstId}`)).expect(
          200,
        )
      ).body,
    );
    expect(booking).toMatchObject({
      status: 'cancelled',
      cancelledBy: 'customer',
    });

    const again = await cancel(firstId).expect(400);
    expect(asError(again.body).code).toBe('BOOKING_NOT_CANCELLABLE');
    const after = asSuccess<{ cancellableUntil?: string }>(
      (await detail(firstId).expect(200)).body,
    );
    expect(after.cancellableUntil).toBeUndefined();
  });

  it('refuses once the free cancellation period is over', async () => {
    // 30 days: next week's booking is already inside it.
    await staff(request(server).patch(`/api/v1/offers/${offerId}`))
      .send({ cancellationHours: 720 })
      .expect(200);
    const res = await cancel(secondId).expect(400);
    expect(asError(res.body).code).toBe('CANCELLATION_DEADLINE_PASSED');
  });

  it('refuses when the offer has no online cancellation', async () => {
    await staff(request(server).patch(`/api/v1/offers/${offerId}`))
      .send({ cancellationHours: null })
      .expect(200);
    const res = await cancel(secondId).expect(400);
    expect(asError(res.body).code).toBe('CANCELLATION_NOT_OFFERED');
    const booking = asSuccess<{ status: string }>(
      (await detail(secondId).expect(200)).body,
    );
    expect(booking.status).toBe('confirmed');
  });
});
