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
interface PublicOrganizationPayload {
  name: string;
  enabledModules: string[];
  logo?: string;
  brandColor?: string;
  tagline?: string;
  heroImage?: string;
}
interface TrackedOrderPayload {
  number: string;
  status: string;
  total: number;
  currency: string;
  items: { description: string; quantity: number; unitPrice: number }[];
}
interface TrackedBookingPayload {
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

  describe('storefront branding', () => {
    it('exposes logo and brandColor publicly once set, and omits brandColor when unset', async () => {
      const { accessToken, organizationId, slug } = await setupStorefrontOrg(
        'storefront-branding@korva.test',
        'Branding Storefront Org',
      );

      const before = await request(server)
        .get(`/api/v1/public/${slug}`)
        .expect(200);
      expect(
        asSuccess<PublicOrganizationPayload>(before.body).brandColor,
      ).toBeUndefined();

      await request(server)
        .patch('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          logo: 'https://cdn.korva.test/logos/branding-storefront.png',
          brandColor: '#ff6600',
          tagline: 'Le meilleur salon de la ville',
          heroImage: 'https://cdn.korva.test/hero/branding-storefront.png',
        })
        .expect(200);

      const after = await request(server)
        .get(`/api/v1/public/${slug}`)
        .expect(200);
      const info = asSuccess<PublicOrganizationPayload>(after.body);
      expect(info.logo).toBe(
        'https://cdn.korva.test/logos/branding-storefront.png',
      );
      expect(info.brandColor).toBe('#ff6600');
      expect(info.tagline).toBe('Le meilleur salon de la ville');
      expect(info.heroImage).toBe(
        'https://cdn.korva.test/hero/branding-storefront.png',
      );
    });
  });

  describe('order tracking', () => {
    let slug: string;
    let activeOfferId: string;
    let orderNumber: string;
    const customerEmail = 'track-me@customer.test';

    beforeAll(async () => {
      const {
        accessToken,
        organizationId,
        slug: orgSlug,
      } = await setupStorefrontOrg(
        'storefront-order-tracking@korva.test',
        'Order Tracking Org',
      );
      slug = orgSlug;

      const offerRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'product',
          name: 'Tracked Mug',
          status: 'active',
          pricing: { amount: 15, currency: 'EUR' },
        })
        .expect(201);
      activeOfferId = asSuccess<OfferPayload>(offerRes.body).id;

      const orderRes = await request(server)
        .post(`/api/v1/public/${slug}/orders`)
        .send({
          items: [{ offerId: activeOfferId, quantity: 2 }],
          currency: 'EUR',
          contact: { email: customerEmail, firstName: 'Track' },
        })
        .expect(201);
      orderNumber = asSuccess<PublicOrderPayload>(orderRes.body).number;
    });

    it('returns the real order when the order number and email both match', async () => {
      const res = await request(server)
        .get(
          `/api/v1/public/${slug}/orders/${orderNumber}?email=${encodeURIComponent(customerEmail)}`,
        )
        .expect(200);
      const order = asSuccess<TrackedOrderPayload>(res.body);
      expect(order.number).toBe(orderNumber);
      expect(order.status).toBe('pending');
      expect(order.total).toBe(30);
      expect(order.currency).toBe('EUR');
      expect(order.items).toEqual([
        { description: 'Tracked Mug', quantity: 2, unitPrice: 15 },
      ]);
    });

    it('returns a generic 404 for a real order number with the wrong email (never distinguished from "not found")', async () => {
      const res = await request(server)
        .get(
          `/api/v1/public/${slug}/orders/${orderNumber}?email=${encodeURIComponent('attacker@evil.test')}`,
        )
        .expect(404);
      expect(asError(res.body).code).toBe('ORDER_NOT_FOUND');
    });

    it('returns the same generic 404 for an order number that does not exist at all', async () => {
      const res = await request(server)
        .get(
          `/api/v1/public/${slug}/orders/CMD-DOES-NOT-EXIST?email=${encodeURIComponent(customerEmail)}`,
        )
        .expect(404);
      expect(asError(res.body).code).toBe('ORDER_NOT_FOUND');
    });

    it('returns the same generic 404 when the real order number is looked up under a different organization (cross-tenant)', async () => {
      const { slug: otherSlug } = await setupStorefrontOrg(
        'storefront-order-tracking-other@korva.test',
        'Order Tracking Other Org',
      );

      const res = await request(server)
        .get(
          `/api/v1/public/${otherSlug}/orders/${orderNumber}?email=${encodeURIComponent(customerEmail)}`,
        )
        .expect(404);
      expect(asError(res.body).code).toBe('ORDER_NOT_FOUND');
    });

    it('rejects a lookup with no email query param as a validation error, not a 404', async () => {
      const res = await request(server)
        .get(`/api/v1/public/${slug}/orders/${orderNumber}`)
        .expect(400);
      expect(asError(res.body).code).toBe('VALIDATION_ERROR');
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

  describe('booking tracking', () => {
    let slug: string;
    let resourceId: string;
    let offerId: string;
    let bookingId: string;
    const monday = nextMonday();
    const customerEmail = 'track-booking@customer.test';

    beforeAll(async () => {
      const {
        accessToken,
        organizationId,
        slug: orgSlug,
      } = await setupStorefrontOrg(
        'storefront-booking-tracking@korva.test',
        'Booking Tracking Org',
      );
      slug = orgSlug;

      const resourceRes = await request(server)
        .post('/api/v1/resources')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'Tracked Studio',
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
          name: 'Tracked Yoga Class',
          status: 'active',
          pricing: { amount: 20, currency: 'EUR' },
        })
        .expect(201);
      offerId = asSuccess<OfferPayload>(offerRes.body).id;

      const bookingRes = await request(server)
        .post(`/api/v1/public/${slug}/bookings`)
        .send({
          resourceId,
          offerId,
          startAt: `${monday}T12:00:00.000Z`,
          endAt: `${monday}T13:00:00.000Z`,
          contact: { email: customerEmail, firstName: 'Tracked' },
        })
        .expect(201);
      bookingId = asSuccess<PublicBookingPayload>(bookingRes.body).id;
    });

    it('returns the real booking when the booking id and email both match', async () => {
      const res = await request(server)
        .get(
          `/api/v1/public/${slug}/bookings/${bookingId}?email=${encodeURIComponent(customerEmail)}`,
        )
        .expect(200);
      const booking = asSuccess<TrackedBookingPayload>(res.body);
      expect(booking.id).toBe(bookingId);
      expect(booking.status).toBe('confirmed');
    });

    it('returns a generic 404 for a real booking id with the wrong email', async () => {
      const res = await request(server)
        .get(
          `/api/v1/public/${slug}/bookings/${bookingId}?email=${encodeURIComponent('attacker@evil.test')}`,
        )
        .expect(404);
      expect(asError(res.body).code).toBe('BOOKING_NOT_FOUND');
    });

    it('returns the same generic 404 for a well-formed but non-existent booking id', async () => {
      const res = await request(server)
        .get(
          `/api/v1/public/${slug}/bookings/000000000000000000000000?email=${encodeURIComponent(customerEmail)}`,
        )
        .expect(404);
      expect(asError(res.body).code).toBe('BOOKING_NOT_FOUND');
    });

    it('returns the same generic 404 when the real booking id is looked up under a different organization (cross-tenant)', async () => {
      const { slug: otherSlug } = await setupStorefrontOrg(
        'storefront-booking-tracking-other@korva.test',
        'Booking Tracking Other Org',
      );

      const res = await request(server)
        .get(
          `/api/v1/public/${otherSlug}/bookings/${bookingId}?email=${encodeURIComponent(customerEmail)}`,
        )
        .expect(404);
      expect(asError(res.body).code).toBe('BOOKING_NOT_FOUND');
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

  describe('lead capture (embeddable widget, docs/BUSINESS_OS_AUDIT.md roadmap item #8)', () => {
    it('creates a Contact, a Lead in a lazily-created default pipeline, and a Note carrying the message', async () => {
      const { slug, accessToken, organizationId } = await setupStorefrontOrg(
        'widget-owner@korva.test',
        'Widget Org',
      );

      const res = await request(server)
        .post(`/api/v1/public/${slug}/leads`)
        .send({
          message: "Bonjour, j'aimerais un devis pour un événement.",
          contact: {
            email: 'visitor@customer.test',
            firstName: 'Visiteur',
            phone: '+33600000000',
          },
        })
        .expect(201);
      const lead = asSuccess<{ id: string; status: string }>(res.body);
      expect(lead.status).toBe('open');

      const pipelinesRes = await request(server)
        .get('/api/v1/pipelines')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const pipelines = asSuccess<
        { id: string; name: string; isDefault: boolean }[]
      >(pipelinesRes.body);
      expect(pipelines).toHaveLength(1);
      expect(pipelines[0]).toMatchObject({ name: 'Ventes', isDefault: true });

      const leadsRes = await request(server)
        .get('/api/v1/leads')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const leads = asSuccess<
        { id: string; source?: string; pipelineId: string }[]
      >(leadsRes.body);
      expect(leads.map((l) => l.id)).toContain(lead.id);
      const createdLead = leads.find((l) => l.id === lead.id)!;
      expect(createdLead.source).toBe('website_widget');
      expect(createdLead.pipelineId).toBe(pipelines[0]!.id);

      const contactsRes = await request(server)
        .get('/api/v1/contacts?search=visitor@customer.test')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const contacts = asSuccess<{ id: string; firstName?: string }[]>(
        contactsRes.body,
      );
      expect(contacts.some((c) => c.firstName === 'Visiteur')).toBe(true);
    });

    it("reuses the second lead's request on the same visitor's existing Contact instead of creating a duplicate, and reuses the same default pipeline", async () => {
      const { slug, accessToken, organizationId } = await setupStorefrontOrg(
        'widget-repeat-owner@korva.test',
        'Widget Repeat Org',
      );

      await request(server)
        .post(`/api/v1/public/${slug}/leads`)
        .send({
          message: 'Première demande',
          contact: { email: 'repeat-visitor@customer.test' },
        })
        .expect(201);
      await request(server)
        .post(`/api/v1/public/${slug}/leads`)
        .send({
          message: 'Deuxième demande',
          contact: { email: 'repeat-visitor@customer.test' },
        })
        .expect(201);

      const contactsRes = await request(server)
        .get('/api/v1/contacts?search=repeat-visitor@customer.test')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<{ id: string }[]>(contactsRes.body)).toHaveLength(1);

      const pipelinesRes = await request(server)
        .get('/api/v1/pipelines')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<{ id: string }[]>(pipelinesRes.body)).toHaveLength(1);
    });

    it('accepts a custom source and rejects a request missing the required message', async () => {
      const { slug } = await setupStorefrontOrg(
        'widget-source-owner@korva.test',
        'Widget Source Org',
      );

      const customSourceRes = await request(server)
        .post(`/api/v1/public/${slug}/leads`)
        .send({
          message: 'Demande depuis mon propre site',
          source: 'my_existing_website',
          contact: { email: 'custom-source@customer.test' },
        })
        .expect(201);
      expect(asSuccess<{ id: string }>(customSourceRes.body).id).toBeTruthy();

      const missingMessageRes = await request(server)
        .post(`/api/v1/public/${slug}/leads`)
        .send({ contact: { email: 'no-message@customer.test' } })
        .expect(400);
      expect(asError(missingMessageRes.body).code).toBe('VALIDATION_ERROR');
    });

    it('404s with MODULE_NOT_AVAILABLE when the organization has not enabled crm', async () => {
      const { slug } = await setupStorefrontOrg(
        'widget-no-crm-owner@korva.test',
        'Widget No CRM Org',
        ['catalog'],
      );

      const res = await request(server)
        .post(`/api/v1/public/${slug}/leads`)
        .send({
          message: 'Bonjour',
          contact: { email: 'x@customer.test' },
        })
        .expect(404);
      expect(asError(res.body).code).toBe('MODULE_NOT_AVAILABLE');
    });

    // Permissive CORS on this path (so the embeddable widget works from any external site) is
    // set by publicCorsMiddleware, which main.ts registers directly on the Express app inside
    // bootstrap() — this file's app is built via Test.createTestingModule(...).compile() +
    // createNestApplication(), which never runs main.ts/bootstrap() at all (same as every other
    // e2e file in this repo: none of them exercise app.enableCors() either). See
    // public-cors.middleware.spec.ts for a direct unit test of that middleware's behavior
    // instead.
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
