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
interface CustomerAuthPayload {
  accessToken: string;
  refreshToken: string;
  customer: { id: string; email: string; firstName?: string };
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

describe('Customer portal auth (e2e)', () => {
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

  async function setupOrg(email: string, orgName: string): Promise<string> {
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
      .send({ enabledModules: ['crm', 'catalog', 'booking', 'commerce'] })
      .expect(200);

    return organization.slug;
  }

  describe('register/login', () => {
    let slug: string;

    beforeAll(async () => {
      slug = await setupOrg('owner-cust-1@example.com', 'Cust Auth Org 1');
    });

    it('registers a new customer and issues tokens', async () => {
      const res = await request(server)
        .post(`/api/v1/public/${slug}/account/register`)
        .send({
          email: 'client1@example.com',
          password: 'clientpass123',
          firstName: 'Alice',
        })
        .expect(201);
      const body = asSuccess<CustomerAuthPayload>(res.body);
      expect(body.accessToken).toBeDefined();
      expect(body.refreshToken).toBeDefined();
      expect(body.customer.email).toBe('client1@example.com');
    });

    it('rejects a duplicate email within the same organization', async () => {
      const res = await request(server)
        .post(`/api/v1/public/${slug}/account/register`)
        .send({ email: 'client1@example.com', password: 'clientpass123' })
        .expect(409);
      expect(asError(res.body).code).toBe('EMAIL_TAKEN');
    });

    it('allows the same email to register independently in a different organization', async () => {
      const otherSlug = await setupOrg(
        'owner-cust-2@example.com',
        'Cust Auth Org 2',
      );
      await request(server)
        .post(`/api/v1/public/${otherSlug}/account/register`)
        .send({ email: 'client1@example.com', password: 'clientpass123' })
        .expect(201);
    });

    it('logs in with correct credentials', async () => {
      const res = await request(server)
        .post(`/api/v1/public/${slug}/account/login`)
        .send({ email: 'client1@example.com', password: 'clientpass123' })
        .expect(201);
      const body = asSuccess<CustomerAuthPayload>(res.body);
      expect(body.accessToken).toBeDefined();
    });

    it('rejects an incorrect password', async () => {
      const res = await request(server)
        .post(`/api/v1/public/${slug}/account/login`)
        .send({ email: 'client1@example.com', password: 'wrong-password' })
        .expect(401);
      expect(asError(res.body).code).toBe('INVALID_CREDENTIALS');
    });

    it('locks the account after 5 failed attempts', async () => {
      const email = 'lockout-target@example.com';
      await request(server)
        .post(`/api/v1/public/${slug}/account/register`)
        .send({ email, password: 'clientpass123' })
        .expect(201);

      for (let i = 0; i < 5; i++) {
        await request(server)
          .post(`/api/v1/public/${slug}/account/login`)
          .send({ email, password: 'wrong-password' })
          .expect(401);
      }

      const res = await request(server)
        .post(`/api/v1/public/${slug}/account/login`)
        .send({ email, password: 'clientpass123' })
        .expect(401);
      expect(asError(res.body).code).toBe('ACCOUNT_LOCKED');
    });
  });

  describe('cross-boundary and tenant isolation', () => {
    let slugA: string;
    let slugB: string;
    let customerTokenOrgA: string;
    let staffTokenOrgA: string;

    beforeAll(async () => {
      slugA = await setupOrg('owner-cust-3@example.com', 'Cust Auth Org 3');
      slugB = await setupOrg('owner-cust-4@example.com', 'Cust Auth Org 4');

      const authRes = await request(server)
        .post('/api/v1/auth/register')
        .send({
          email: 'staff-cust-boundary@example.com',
          password: 'password123',
        })
        .expect(201);
      staffTokenOrgA = asSuccess<AuthPayload>(authRes.body).accessToken;

      const registerRes = await request(server)
        .post(`/api/v1/public/${slugA}/account/register`)
        .send({
          email: 'boundary-client@example.com',
          password: 'clientpass123',
        })
        .expect(201);
      customerTokenOrgA = asSuccess<CustomerAuthPayload>(
        registerRes.body,
      ).accessToken;
    });

    it('rejects a customer access token used against a staff-only endpoint', async () => {
      await request(server)
        .get('/api/v1/contacts')
        .set('Authorization', `Bearer ${customerTokenOrgA}`)
        .set('X-Organization-Id', 'irrelevant')
        .expect(401);
    });

    it('rejects a staff access token used against the customer /me endpoint', async () => {
      await request(server)
        .get(`/api/v1/public/${slugA}/account/me`)
        .set('Authorization', `Bearer ${staffTokenOrgA}`)
        .expect(401);
    });

    it("rejects a customer token for org A when presented against org B's slug", async () => {
      await request(server)
        .get(`/api/v1/public/${slugB}/account/me`)
        .set('Authorization', `Bearer ${customerTokenOrgA}`)
        .expect(401);
    });

    it('returns the profile for the correct org+slug combination', async () => {
      const res = await request(server)
        .get(`/api/v1/public/${slugA}/account/me`)
        .set('Authorization', `Bearer ${customerTokenOrgA}`)
        .expect(200);
      expect(asSuccess<{ email: string }>(res.body).email).toBe(
        'boundary-client@example.com',
      );
    });
  });

  describe('order/booking history isolation', () => {
    let slug: string;
    let organizationId: string;
    let staffToken: string;
    let customerAToken: string;
    let customerBToken: string;
    let offerId: string;

    beforeAll(async () => {
      const authRes = await request(server)
        .post('/api/v1/auth/register')
        .send({ email: 'owner-cust-5@example.com', password: 'password123' })
        .expect(201);
      staffToken = asSuccess<AuthPayload>(authRes.body).accessToken;

      const orgRes = await request(server)
        .post('/api/v1/organizations')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          name: 'Cust Auth Org 5',
          type: 'commerce',
          country: 'FR',
          currency: 'EUR',
          timezone: 'Europe/Paris',
          language: 'fr',
        })
        .expect(201);
      const organization = asSuccess<OrganizationPayload>(orgRes.body);
      slug = organization.slug;
      organizationId = organization.id;

      await request(server)
        .patch('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ enabledModules: ['crm', 'catalog', 'commerce'] })
        .expect(200);

      const offerRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'product',
          name: 'Widget',
          status: 'active',
          pricing: { amount: 20, currency: 'EUR' },
        })
        .expect(201);
      offerId = asSuccess<{ id: string }>(offerRes.body).id;

      const regA = await request(server)
        .post(`/api/v1/public/${slug}/account/register`)
        .send({ email: 'history-a@example.com', password: 'clientpass123' })
        .expect(201);
      customerAToken = asSuccess<CustomerAuthPayload>(regA.body).accessToken;

      const regB = await request(server)
        .post(`/api/v1/public/${slug}/account/register`)
        .send({ email: 'history-b@example.com', password: 'clientpass123' })
        .expect(201);
      customerBToken = asSuccess<CustomerAuthPayload>(regB.body).accessToken;

      // Customer A places an order via the guest checkout path (email-matched to their account).
      await request(server)
        .post(`/api/v1/public/${slug}/orders`)
        .send({
          items: [{ offerId, quantity: 1 }],
          currency: 'EUR',
          contact: { email: 'history-a@example.com', firstName: 'A' },
        })
        .expect(201);
    });

    it("only returns the authenticated customer's own orders", async () => {
      const resA = await request(server)
        .get(`/api/v1/public/${slug}/account/orders`)
        .set('Authorization', `Bearer ${customerAToken}`)
        .expect(200);
      expect(asSuccess<unknown[]>(resA.body)).toHaveLength(1);

      const resB = await request(server)
        .get(`/api/v1/public/${slug}/account/orders`)
        .set('Authorization', `Bearer ${customerBToken}`)
        .expect(200);
      expect(asSuccess<unknown[]>(resB.body)).toHaveLength(0);
    });
  });

  describe('order/booking detail, invoice/certificate PDFs, and reviews', () => {
    let slug: string;
    let organizationId: string;
    let staffToken: string;
    let customerToken: string;
    let otherCustomerToken: string;
    let orderId: string;
    let bookingId: string;

    beforeAll(async () => {
      const authRes = await request(server)
        .post('/api/v1/auth/register')
        .send({ email: 'owner-cust-7@example.com', password: 'password123' })
        .expect(201);
      staffToken = asSuccess<AuthPayload>(authRes.body).accessToken;

      const orgRes = await request(server)
        .post('/api/v1/organizations')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          name: 'Cust Auth Org 7',
          type: 'commerce',
          country: 'FR',
          currency: 'EUR',
          timezone: 'Europe/Paris',
          language: 'fr',
        })
        .expect(201);
      const organization = asSuccess<OrganizationPayload>(orgRes.body);
      slug = organization.slug;
      organizationId = organization.id;

      await request(server)
        .patch('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ enabledModules: ['crm', 'catalog', 'commerce', 'booking', 'finance'] })
        .expect(200);

      const contactRes = await request(server)
        .post('/api/v1/contacts')
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ type: 'person', firstName: 'Detail', email: 'detail-customer@example.com' })
        .expect(201);
      const contactId = asSuccess<{ id: string }>(contactRes.body).id;

      const offerRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'product',
          name: 'Detail Widget',
          status: 'active',
          pricing: { amount: 30, currency: 'EUR' },
        })
        .expect(201);
      const offerId = asSuccess<{ id: string }>(offerRes.body).id;

      const bookingOfferRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'booking',
          name: 'Detail Session',
          status: 'active',
          pricing: { amount: 50, currency: 'EUR' },
        })
        .expect(201);
      const bookingOfferId = asSuccess<{ id: string }>(bookingOfferRes.body).id;

      const resourceRes = await request(server)
        .post('/api/v1/resources')
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'Room 1',
          type: 'room',
          capacity: 1,
          weeklyAvailability: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
            dayOfWeek,
            startTime: '08:00',
            endTime: '20:00',
          })),
        })
        .expect(201);
      const resourceId = asSuccess<{ id: string }>(resourceRes.body).id;

      // Order: create -> confirm -> fulfill -> generate invoice -> issue.
      const orderRes = await request(server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          items: [{ offerId, description: 'Detail Widget', quantity: 1, unitPrice: 30 }],
          currency: 'EUR',
        })
        .expect(201);
      orderId = asSuccess<{ id: string }>(orderRes.body).id;
      await request(server)
        .post(`/api/v1/orders/${orderId}/confirm`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      await request(server)
        .post(`/api/v1/orders/${orderId}/fulfill`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      const invoiceRes = await request(server)
        .post(`/api/v1/orders/${orderId}/generate-invoice`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      const invoiceId = asSuccess<{ id: string }>(invoiceRes.body).id;
      await request(server)
        .post(`/api/v1/invoices/${invoiceId}/issue`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      // Booking: create -> complete(attended: true).
      const bookingRes = await request(server)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          resourceId,
          offerId: bookingOfferId,
          contactId,
          startAt: new Date(Date.now() + 3_600_000).toISOString(),
          endAt: new Date(Date.now() + 7_200_000).toISOString(),
        })
        .expect(201);
      bookingId = asSuccess<{ id: string }>(bookingRes.body).id;
      await request(server)
        .post(`/api/v1/bookings/${bookingId}/complete`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ attended: true })
        .expect(201);

      // Customer account, matched by email to the same contact created above.
      const custRes = await request(server)
        .post(`/api/v1/public/${slug}/account/register`)
        .send({ email: 'detail-customer@example.com', password: 'clientpass123' })
        .expect(201);
      customerToken = asSuccess<CustomerAuthPayload>(custRes.body).accessToken;

      const otherRes = await request(server)
        .post(`/api/v1/public/${slug}/account/register`)
        .send({ email: 'other-customer@example.com', password: 'clientpass123' })
        .expect(201);
      otherCustomerToken = asSuccess<CustomerAuthPayload>(otherRes.body).accessToken;
    });

    it('returns full order detail including line items and hasInvoice', async () => {
      const res = await request(server)
        .get(`/api/v1/public/${slug}/account/orders/${orderId}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);
      const order = asSuccess<{ hasInvoice: boolean; items: unknown[]; status: string }>(
        res.body,
      );
      expect(order.status).toBe('fulfilled');
      expect(order.hasInvoice).toBe(true);
      expect(order.items).toHaveLength(1);
    });

    it("404s another customer's order detail", async () => {
      await request(server)
        .get(`/api/v1/public/${slug}/account/orders/${orderId}`)
        .set('Authorization', `Bearer ${otherCustomerToken}`)
        .expect(404);
    });

    it('downloads the invoice PDF for the order owner', async () => {
      const res = await request(server)
        .get(`/api/v1/public/${slug}/account/orders/${orderId}/invoice-pdf`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);
      expect(res.headers['content-type']).toBe('application/pdf');
    });

    it("rejects another customer's invoice PDF request", async () => {
      await request(server)
        .get(`/api/v1/public/${slug}/account/orders/${orderId}/invoice-pdf`)
        .set('Authorization', `Bearer ${otherCustomerToken}`)
        .expect(404);
    });

    it('returns booking detail with attended + offerName', async () => {
      const res = await request(server)
        .get(`/api/v1/public/${slug}/account/bookings/${bookingId}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);
      const booking = asSuccess<{ status: string; attended: boolean; offerName: string }>(
        res.body,
      );
      expect(booking.status).toBe('completed');
      expect(booking.attended).toBe(true);
      expect(booking.offerName).toBe('Detail Session');
    });

    it('downloads the booking certificate for a completed, attended booking', async () => {
      const res = await request(server)
        .get(`/api/v1/public/${slug}/account/bookings/${bookingId}/certificate`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);
      expect(res.headers['content-type']).toBe('application/pdf');
    });

    it('creates a review for a fulfilled order', async () => {
      const res = await request(server)
        .post(`/api/v1/public/${slug}/account/reviews`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ entity: 'order', entityId: orderId, rating: 5, comment: 'Great!' })
        .expect(201);
      expect(asSuccess<{ rating: number }>(res.body).rating).toBe(5);
    });

    it('rejects a second review for the same order', async () => {
      const res = await request(server)
        .post(`/api/v1/public/${slug}/account/reviews`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ entity: 'order', entityId: orderId, rating: 3 })
        .expect(409);
      expect(asError(res.body).code).toBe('REVIEW_ALREADY_EXISTS');
    });

    it("rejects a review for another customer's order", async () => {
      const res = await request(server)
        .post(`/api/v1/public/${slug}/account/reviews`)
        .set('Authorization', `Bearer ${otherCustomerToken}`)
        .send({ entity: 'order', entityId: orderId, rating: 1 })
        .expect(404);
      expect(asError(res.body).code).toBe('ORDER_NOT_FOUND');
    });

    it('the staff-facing reviews list surfaces the created review', async () => {
      const res = await request(server)
        .get('/api/v1/reviews')
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const reviews = asSuccess<{ rating: number; comment?: string }[]>(res.body);
      expect(reviews.some((r) => r.rating === 5 && r.comment === 'Great!')).toBe(true);
    });
  });

  describe('password reset', () => {
    let slug: string;

    beforeAll(async () => {
      slug = await setupOrg('owner-cust-6@example.com', 'Cust Auth Org 6');
      await request(server)
        .post(`/api/v1/public/${slug}/account/register`)
        .send({ email: 'reset-target@example.com', password: 'original-pass' })
        .expect(201);
    });

    it('accepts a forgot-password request with a generic response regardless of existence', async () => {
      const known = await request(server)
        .post(`/api/v1/public/${slug}/account/forgot-password`)
        .send({ email: 'reset-target@example.com' })
        .expect(201);
      const unknown = await request(server)
        .post(`/api/v1/public/${slug}/account/forgot-password`)
        .send({ email: 'never-registered@example.com' })
        .expect(201);
      expect(asSuccess<{ message: string }>(known.body).message).toBe(
        asSuccess<{ message: string }>(unknown.body).message,
      );
    });

    it('rejects an invalid reset token', async () => {
      const res = await request(server)
        .post(`/api/v1/public/${slug}/account/reset-password`)
        .send({ token: 'not-a-real-token', password: 'new-password-123' })
        .expect(401);
      expect(asError(res.body).code).toBe('INVALID_RESET_TOKEN');
    });
  });
});
