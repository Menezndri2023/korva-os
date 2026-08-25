import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

interface ApiSuccess<T> {
  success: true;
  data: T;
}
interface ApiError {
  success: false;
  error: { code: string; message: string };
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
  status: string;
  startAt: string;
  endAt: string;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

/** Returns an ISO date string (YYYY-MM-DD) for the next occurrence of `dayOfWeek` (0=Sunday) from now, at least 7 days out to stay clear of "today" edge cases. */
function nextDateFor(dayOfWeek: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 7);
  while (date.getUTCDay() !== dayOfWeek) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}

describe('Booking module (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;

  const monday = nextDateFor(1);

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

  async function registerOrgContactOffer(email: string, orgName: string) {
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
        type: 'booking',
        country: 'FR',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        language: 'fr',
      })
      .expect(201);
    const organizationId = asSuccess<OrganizationPayload>(orgRes.body).id;

    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ enabledModules: ['crm', 'catalog', 'booking'] })
      .expect(200);

    const contactRes = await request(server)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ firstName: 'Guest' })
      .expect(201);
    const contactId = asSuccess<ContactPayload>(contactRes.body).id;

    const offerRes = await request(server)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        type: 'booking',
        name: 'Session',
        pricing: { amount: 80, currency: 'EUR' },
      })
      .expect(201);
    const offerId = asSuccess<OfferPayload>(offerRes.body).id;

    return { accessToken, organizationId, contactId, offerId };
  }

  describe('resources, availability windows and bookings', () => {
    let accessToken: string;
    let organizationId: string;
    let contactId: string;
    let offerId: string;
    let resourceId: string;
    let bookingId: string;

    beforeAll(async () => {
      const ctx = await registerOrgContactOffer(
        'booking-owner@korva.test',
        'Booking Org',
      );
      accessToken = ctx.accessToken;
      organizationId = ctx.organizationId;
      contactId = ctx.contactId;
      offerId = ctx.offerId;

      const resourceRes = await request(server)
        .post('/api/v1/resources')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'Room 1',
          type: 'room',
          capacity: 1,
          weeklyAvailability: [
            { dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },
          ],
        })
        .expect(201);
      resourceId = asSuccess<ResourcePayload>(resourceRes.body).id;
    });

    it('shows the configured weekly window with no bookings for the day', async () => {
      const res = await request(server)
        .get(`/api/v1/availability?resourceId=${resourceId}&date=${monday}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const availability = asSuccess<{
        windows: unknown[];
        bookings: unknown[];
      }>(res.body);
      expect(availability.windows).toEqual([
        { startTime: '09:00', endTime: '18:00' },
      ]);
      expect(availability.bookings).toEqual([]);
    });

    it('rejects a booking outside the weekly availability window', async () => {
      const res = await request(server)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          resourceId,
          offerId,
          contactId,
          startAt: `${monday}T07:00:00.000Z`,
          endAt: `${monday}T08:00:00.000Z`,
        })
        .expect(400);
      expect(asError(res.body).code).toBe('OUTSIDE_AVAILABILITY_WINDOW');
    });

    it('creates a booking within the window, copying the offer price', async () => {
      const res = await request(server)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          resourceId,
          offerId,
          contactId,
          startAt: `${monday}T10:00:00.000Z`,
          endAt: `${monday}T11:00:00.000Z`,
        })
        .expect(201);
      const booking = asSuccess<
        BookingPayload & { pricing: { amount: number } }
      >(res.body);
      bookingId = booking.id;
      expect(booking.status).toBe('confirmed');
      expect(booking.pricing.amount).toBe(80);
    });

    it('rejects an overlapping booking on a capacity-1 resource', async () => {
      const res = await request(server)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          resourceId,
          offerId,
          contactId,
          startAt: `${monday}T10:30:00.000Z`,
          endAt: `${monday}T11:30:00.000Z`,
        })
        .expect(400);
      expect(asError(res.body).code).toBe('SLOT_UNAVAILABLE');
    });

    it('reflects the booking in the day availability view', async () => {
      const res = await request(server)
        .get(`/api/v1/availability?resourceId=${resourceId}&date=${monday}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const availability = asSuccess<{
        bookings: { startAt: string; endAt: string }[];
      }>(res.body);
      expect(availability.bookings).toHaveLength(1);
    });

    it('reschedules the booking to a free slot', async () => {
      const res = await request(server)
        .post(`/api/v1/bookings/${bookingId}/reschedule`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          startAt: `${monday}T14:00:00.000Z`,
          endAt: `${monday}T15:00:00.000Z`,
        })
        .expect(201);
      expect(asSuccess<BookingPayload>(res.body).startAt).toBe(
        `${monday}T14:00:00.000Z`,
      );
    });

    it('cancels the booking and then rejects cancelling it again', async () => {
      await request(server)
        .post(`/api/v1/bookings/${bookingId}/cancel`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      const res = await request(server)
        .post(`/api/v1/bookings/${bookingId}/cancel`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(400);
      expect(asError(res.body).code).toBe('BOOKING_ALREADY_CANCELLED');
    });

    it('allows a new booking on the slot freed up by the cancellation', async () => {
      await request(server)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          resourceId,
          offerId,
          contactId,
          startAt: `${monday}T10:00:00.000Z`,
          endAt: `${monday}T11:00:00.000Z`,
        })
        .expect(201);
    });
  });

  describe('blocked slots and capacity', () => {
    let accessToken: string;
    let organizationId: string;
    let contactId: string;
    let offerId: string;
    let resourceId: string;

    beforeAll(async () => {
      const ctx = await registerOrgContactOffer(
        'capacity-owner@korva.test',
        'Capacity Org',
      );
      accessToken = ctx.accessToken;
      organizationId = ctx.organizationId;
      contactId = ctx.contactId;
      offerId = ctx.offerId;

      const resourceRes = await request(server)
        .post('/api/v1/resources')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'Group class',
          type: 'space',
          capacity: 2,
          weeklyAvailability: [
            { dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },
          ],
        })
        .expect(201);
      resourceId = asSuccess<ResourcePayload>(resourceRes.body).id;

      await request(server)
        .post(`/api/v1/resources/${resourceId}/blocked-slots`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          startAt: `${monday}T12:00:00.000Z`,
          endAt: `${monday}T13:00:00.000Z`,
          reason: 'Lunch break',
        })
        .expect(201);
    });

    it('rejects a booking overlapping a blocked slot', async () => {
      const res = await request(server)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          resourceId,
          offerId,
          contactId,
          startAt: `${monday}T12:30:00.000Z`,
          endAt: `${monday}T13:00:00.000Z`,
        })
        .expect(400);
      expect(asError(res.body).code).toBe('SLOT_BLOCKED');
    });

    it('allows bookings up to capacity and rejects the one beyond it', async () => {
      await request(server)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          resourceId,
          offerId,
          contactId,
          startAt: `${monday}T10:00:00.000Z`,
          endAt: `${monday}T11:00:00.000Z`,
        })
        .expect(201);

      await request(server)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          resourceId,
          offerId,
          contactId,
          startAt: `${monday}T10:00:00.000Z`,
          endAt: `${monday}T11:00:00.000Z`,
        })
        .expect(201);

      const res = await request(server)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          resourceId,
          offerId,
          contactId,
          startAt: `${monday}T10:00:00.000Z`,
          endAt: `${monday}T11:00:00.000Z`,
        })
        .expect(400);
      expect(asError(res.body).code).toBe('SLOT_UNAVAILABLE');
    });
  });

  describe('concurrent booking creation on a capacity-1 resource', () => {
    // Regression test for P0-BOOKING-01: BookingsService.create() used to read the overlap
    // count and insert the new Booking as two separate, non-atomic steps, so two concurrent
    // requests for the same resource/slot at capacity-1 could both read "under capacity" before
    // either wrote, double-booking the resource. Both requests below are dispatched before
    // either is awaited — a genuine race, not two sequential calls (mirrors the concurrency
    // tests in finance.e2e-spec.ts).
    let accessToken: string;
    let organizationId: string;
    let contactId: string;
    let offerId: string;
    let resourceId: string;

    beforeAll(async () => {
      const ctx = await registerOrgContactOffer(
        'race-owner@korva.test',
        'Race Org',
      );
      accessToken = ctx.accessToken;
      organizationId = ctx.organizationId;
      contactId = ctx.contactId;
      offerId = ctx.offerId;

      const resourceRes = await request(server)
        .post('/api/v1/resources')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'Single seat',
          type: 'seat',
          capacity: 1,
          weeklyAvailability: [
            { dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },
          ],
        })
        .expect(201);
      resourceId = asSuccess<ResourcePayload>(resourceRes.body).id;
    });

    it('two concurrent bookings for the same slot: exactly one succeeds, the other gets a clean SLOT_UNAVAILABLE, and only one booking is ever persisted', async () => {
      const payload = {
        resourceId,
        offerId,
        contactId,
        startAt: `${monday}T14:00:00.000Z`,
        endAt: `${monday}T15:00:00.000Z`,
      };

      const [resA, resB] = await Promise.all([
        request(server)
          .post('/api/v1/bookings')
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .send(payload),
        request(server)
          .post('/api/v1/bookings')
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .send(payload),
      ]);

      const results = [resA, resB];
      const succeeded = results.filter((r) => r.status === 201);
      const rejected = results.filter((r) => r.status === 400);
      expect(succeeded).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(asError(rejected[0]!.body).code).toBe('SLOT_UNAVAILABLE');

      // No orphaned/duplicate Booking document: exactly one active booking exists for this
      // resource/slot, whichever request won the race.
      const listRes = await request(server)
        .get(`/api/v1/bookings?resourceId=${resourceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const bookings = asSuccess<BookingPayload[]>(listRes.body);
      const forSlot = bookings.filter(
        (b) => b.startAt === payload.startAt && b.endAt === payload.endAt,
      );
      expect(forSlot).toHaveLength(1);
      expect(forSlot[0]!.id).toBe(
        asSuccess<BookingPayload>(succeeded[0]!.body).id,
      );
    });
  });

  describe('tenant isolation for booking resources', () => {
    it('denies a user from another organization reading resources via a foreign org id', async () => {
      const a = await registerOrgContactOffer(
        'booking-iso-a@korva.test',
        'Booking Iso A',
      );
      const b = await registerOrgContactOffer(
        'booking-iso-b@korva.test',
        'Booking Iso B',
      );

      await request(server)
        .post('/api/v1/resources')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Organization-Id', a.organizationId)
        .send({ name: 'Secret room', type: 'room' })
        .expect(201);

      const res = await request(server)
        .get('/api/v1/resources')
        .set('Authorization', `Bearer ${b.accessToken}`)
        .set('X-Organization-Id', a.organizationId)
        .expect(403);
      expect(asError(res.body).code).toBe('ORGANIZATION_ACCESS_DENIED');
    });
  });
});
