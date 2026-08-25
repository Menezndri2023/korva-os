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
  slug: string;
}
interface OfferPayload {
  id: string;
  name: string;
}
interface ResourcePayload {
  id: string;
}
interface PublicOfferPayload {
  id: string;
  name: string;
  pricing: { amount: number; currency: string };
}
interface PublicBookingPayload {
  id: string;
  status: string;
}
interface PublicOrderPayload {
  id: string;
  number: string;
  total: number;
  status: string;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

describe('Public storefront API (e2e)', () => {
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

  async function setupStorefrontOrg(
    email: string,
    orgName: string,
    // "crm" isn't part of what these tests are proving about the public storefront (that's
    // catalog/booking/commerce, checked below via assertModuleEnabled) — it's included here
    // only so the internal GET /contacts calls these tests use to verify a public order/booking
    // created the expected contact are themselves allowed by ModuleGuard.
    modules: string[] = ['catalog', 'booking', 'commerce', 'crm'],
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
        type: 'services',
        country: 'FR',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        language: 'fr',
      })
      .expect(201);
    const organization = asSuccess<OrganizationPayload>(orgRes.body);

    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .send({ enabledModules: modules })
      .expect(200);

    return {
      accessToken,
      organizationId: organization.id,
      slug: organization.slug,
    };
  }

  describe('offers catalog and checkout', () => {
    let accessToken: string;
    let organizationId: string;
    let slug: string;
    let activeOfferId: string;

    beforeAll(async () => {
      ({ accessToken, organizationId, slug } = await setupStorefrontOrg(
        'storefront-owner@korva.test',
        'Storefront Org',
      ));

      const activeOfferRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'product',
          name: 'T-Shirt',
          status: 'active',
          pricing: { amount: 25, currency: 'EUR' },
        })
        .expect(201);
      activeOfferId = asSuccess<OfferPayload>(activeOfferRes.body).id;

      await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'product',
          name: 'Unreleased Product',
          status: 'draft',
          pricing: { amount: 999, currency: 'EUR' },
        })
        .expect(201);
    });

    it('exposes only safe organization fields publicly', async () => {
      const res = await request(server)
        .get(`/api/v1/public/${slug}`)
        .expect(200);
      const info = asSuccess<{ name: string; enabledModules: string[] }>(
        res.body,
      );
      expect(info.name).toBe('Storefront Org');
      expect(info.enabledModules).toEqual(
        expect.arrayContaining(['catalog', 'booking', 'commerce']),
      );
    });

    it('lists only active offers publicly, with no authentication', async () => {
      const res = await request(server)
        .get(`/api/v1/public/${slug}/offers`)
        .expect(200);
      const offers = asSuccess<PublicOfferPayload[]>(res.body);
      expect(offers).toHaveLength(1);
      expect(offers[0]!.name).toBe('T-Shirt');
    });

    it('creates a public order, always pricing from the real offer server-side', async () => {
      const res = await request(server)
        .post(`/api/v1/public/${slug}/orders`)
        .send({
          items: [{ offerId: activeOfferId, quantity: 3 }],
          currency: 'EUR',
          contact: { email: 'guest@customer.test', firstName: 'Guest' },
        })
        .expect(201);
      const order = asSuccess<PublicOrderPayload>(res.body);
      expect(order.total).toBe(75);
      expect(order.status).toBe('pending');

      const contactsRes = await request(server)
        .get('/api/v1/contacts?search=guest@customer.test')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<{ email?: string }[]>(contactsRes.body)).toHaveLength(1);
    });

    it('reuses the same contact for a second public order from the same email', async () => {
      await request(server)
        .post(`/api/v1/public/${slug}/orders`)
        .send({
          items: [{ offerId: activeOfferId, quantity: 1 }],
          currency: 'EUR',
          contact: { email: 'guest@customer.test' },
        })
        .expect(201);

      const contactsRes = await request(server)
        .get('/api/v1/contacts?search=guest@customer.test')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<{ email?: string }[]>(contactsRes.body)).toHaveLength(1);
    });

    it('rejects a public order for an offer that does not exist', async () => {
      const res = await request(server)
        .post(`/api/v1/public/${slug}/orders`)
        .send({
          items: [{ offerId: '000000000000000000000000', quantity: 1 }],
          currency: 'EUR',
          contact: { email: 'ghost@customer.test' },
        })
        .expect(404);
      expect(asError(res.body).code).toBe('OFFER_NOT_FOUND');
    });
  });

  describe('booking flow via the storefront', () => {
    let accessToken: string;
    let organizationId: string;
    let slug: string;
    let resourceId: string;
    let offerId: string;
    const monday = nextMonday();

    beforeAll(async () => {
      ({ accessToken, organizationId, slug } = await setupStorefrontOrg(
        'storefront-booking@korva.test',
        'Storefront Booking Org',
      ));

      const resourceRes = await request(server)
        .post('/api/v1/resources')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'Studio',
          type: 'room',
          weeklyAvailability: [
            { dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },
          ],
        })
        .expect(201);
      resourceId = asSuccess<ResourcePayload>(resourceRes.body).id;

      const offerRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'booking',
          name: 'Yoga Class',
          status: 'active',
          pricing: { amount: 20, currency: 'EUR' },
        })
        .expect(201);
      offerId = asSuccess<OfferPayload>(offerRes.body).id;
    });

    it('lists active resources publicly', async () => {
      const res = await request(server)
        .get(`/api/v1/public/${slug}/resources`)
        .expect(200);
      const resources = asSuccess<{ id: string; name: string }[]>(res.body);
      expect(resources).toHaveLength(1);
      expect(resources[0]!.name).toBe('Studio');
    });

    it('shows availability publicly', async () => {
      const res = await request(server)
        .get(
          `/api/v1/public/${slug}/availability?resourceId=${resourceId}&date=${monday}`,
        )
        .expect(200);
      const availability = asSuccess<{ windows: unknown[] }>(res.body);
      expect(availability.windows).toEqual([
        { startTime: '09:00', endTime: '18:00' },
      ]);
    });

    it('creates a public booking, resolving the contact by email', async () => {
      const res = await request(server)
        .post(`/api/v1/public/${slug}/bookings`)
        .send({
          resourceId,
          offerId,
          startAt: `${monday}T10:00:00.000Z`,
          endAt: `${monday}T11:00:00.000Z`,
          contact: { email: 'yogi@customer.test', firstName: 'Yogi' },
        })
        .expect(201);
      const booking = asSuccess<PublicBookingPayload>(res.body);
      expect(booking.status).toBe('confirmed');
    });
  });

  describe('booking creation throttle (LOT P3-FIX)', () => {
    let slugA: string;
    let resourceIdA: string;
    let offerIdA: string;
    let slugB: string;
    let resourceIdB: string;
    let offerIdB: string;
    const monday = nextMonday();

    async function setupThrottleOrg(email: string, orgName: string) {
      const { accessToken, organizationId, slug } = await setupStorefrontOrg(
        email,
        orgName,
      );
      const resourceRes = await request(server)
        .post('/api/v1/resources')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'Throttle Room',
          type: 'room',
          // A wide window so a burst of test requests can each target a genuinely free hour —
          // a 400 SLOT_UNAVAILABLE (capacity, default 1) must never be mistaken for the 429
          // this suite is actually proving.
          weeklyAvailability: [
            { dayOfWeek: 1, startTime: '00:00', endTime: '23:00' },
          ],
        })
        .expect(201);
      const offerRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'booking',
          name: 'Throttle Session',
          status: 'active',
          pricing: { amount: 10, currency: 'EUR' },
        })
        .expect(201);
      return {
        slug,
        resourceId: asSuccess<ResourcePayload>(resourceRes.body).id,
        offerId: asSuccess<OfferPayload>(offerRes.body).id,
      };
    }

    beforeAll(async () => {
      ({
        slug: slugA,
        resourceId: resourceIdA,
        offerId: offerIdA,
      } = await setupThrottleOrg(
        'storefront-throttle-a@korva.test',
        'Storefront Throttle Org A',
      ));
      ({
        slug: slugB,
        resourceId: resourceIdB,
        offerId: offerIdB,
      } = await setupThrottleOrg(
        'storefront-throttle-b@korva.test',
        'Storefront Throttle Org B',
      ));
    });

    function bookingPayload(resourceId: string, offerId: string, hour: number) {
      const startHour = String(hour).padStart(2, '0');
      const endHour = String(hour + 1).padStart(2, '0');
      return {
        resourceId,
        offerId,
        startAt: `${monday}T${startHour}:00:00.000Z`,
        endAt: `${monday}T${endHour}:00:00.000Z`,
        contact: {
          email: `throttle-${hour}@customer.test`,
          firstName: 'Throttle',
        },
      };
    }

    // Test 1 — normal, low-volume use stays well under the dedicated limit and works normally.
    it('allows a normal, low-volume sequence of booking attempts', async () => {
      const first = await request(server)
        .post(`/api/v1/public/${slugA}/bookings`)
        .send(bookingPayload(resourceIdA, offerIdA, 1));
      const second = await request(server)
        .post(`/api/v1/public/${slugA}/bookings`)
        .send(bookingPayload(resourceIdA, offerIdA, 2));

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
    });

    // Test 2 — a rapid burst on the same route/IP eventually gets 429, proving the dedicated
    // throttle (stricter than the 120/min global) actually engages before too many confirmed
    // bookings can be created in quick succession.
    it('throttles a rapid burst of booking attempts with 429 once the dedicated limit is exceeded', async () => {
      const statuses: number[] = [];
      for (let hour = 3; hour < 20 && !statuses.includes(429); hour++) {
        const res = await request(server)
          .post(`/api/v1/public/${slugA}/bookings`)
          .send(bookingPayload(resourceIdA, offerIdA, hour));
        statuses.push(res.status);
      }

      expect(statuses).toContain(429);
      // The burst didn't start pre-throttled — some earlier requests genuinely succeeded first.
      expect(statuses.some((status) => status === 201)).toBe(true);
    }, 20000);

    // Test 3 — scope: a public GET route is entirely unaffected by the booking route's throttle,
    // even while that IP is currently throttled on POST bookings (per the burst test above).
    it('leaves other public routes unaffected by the booking throttle', async () => {
      await request(server).get(`/api/v1/public/${slugA}/offers`).expect(200);
    });

    // Test 4 — the throttle is a pure anti-abuse mechanism keyed on (route, IP), not a stand-in
    // for tenant isolation: this IP being throttled on org A's booking route also throttles a
    // booking POST for org B, a completely different organization/tenant.
    it('is not tenant-scoped: the same throttled IP is also blocked when booking for a different organization', async () => {
      const res = await request(server)
        .post(`/api/v1/public/${slugB}/bookings`)
        .send(bookingPayload(resourceIdB, offerIdB, 1));

      expect(res.status).toBe(429);
    });
  });

  describe('module gating and unknown organizations', () => {
    it('rejects a public request for a module the organization has not enabled', async () => {
      const { slug } = await setupStorefrontOrg(
        'storefront-no-commerce@korva.test',
        'No Commerce Org',
        ['catalog'],
      );

      const res = await request(server)
        .post(`/api/v1/public/${slug}/orders`)
        .send({
          items: [{ offerId: '000000000000000000000000', quantity: 1 }],
          currency: 'EUR',
          contact: { email: 'x@customer.test' },
        })
        .expect(404);
      expect(asError(res.body).code).toBe('MODULE_NOT_AVAILABLE');
    });

    it('404s for an unknown organization slug', async () => {
      const res = await request(server)
        .get('/api/v1/public/does-not-exist/offers')
        .expect(404);
      expect(asError(res.body).code).toBe('ORGANIZATION_NOT_FOUND');
    });
  });
});

/** Returns an ISO date string (YYYY-MM-DD) for the next Monday, at least 7 days out. */
function nextMonday(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 7);
  while (date.getUTCDay() !== 1) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}
