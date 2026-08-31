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

/**
 * Split out of customer-auth.e2e-spec.ts (not just organized separately) specifically to give
 * these describe blocks their own NestTestingModule instance and therefore their own in-memory
 * ThrottlerStorage — CUSTOMER_AUTH_THROTTLE caps /account/register at 10/min per file-shared app
 * instance, and the combined register-call count across every describe block in one file had
 * grown past that budget (12 calls, 2 over), causing real 429s unrelated to any of the actual
 * behavior under test. Same fix already applied once before in this codebase for the identical
 * class of problem — see the finance.e2e-spec.ts / Expenses-scheduler split.
 */
describe('Customer portal — order/booking/quote purchases (e2e)', () => {
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
        .send({
          enabledModules: ['crm', 'catalog', 'commerce', 'booking', 'finance'],
        })
        .expect(200);

      const contactRes = await request(server)
        .post('/api/v1/contacts')
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'person',
          firstName: 'Detail',
          email: 'detail-customer@example.com',
        })
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
          items: [
            {
              offerId,
              description: 'Detail Widget',
              quantity: 1,
              unitPrice: 30,
            },
          ],
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
        .send({
          email: 'detail-customer@example.com',
          password: 'clientpass123',
        })
        .expect(201);
      customerToken = asSuccess<CustomerAuthPayload>(custRes.body).accessToken;

      const otherRes = await request(server)
        .post(`/api/v1/public/${slug}/account/register`)
        .send({
          email: 'other-customer@example.com',
          password: 'clientpass123',
        })
        .expect(201);
      otherCustomerToken = asSuccess<CustomerAuthPayload>(
        otherRes.body,
      ).accessToken;
    });

    it('returns full order detail including line items and hasInvoice', async () => {
      const res = await request(server)
        .get(`/api/v1/public/${slug}/account/orders/${orderId}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);
      const order = asSuccess<{
        hasInvoice: boolean;
        items: unknown[];
        status: string;
      }>(res.body);
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
      const booking = asSuccess<{
        status: string;
        attended: boolean;
        offerName: string;
      }>(res.body);
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
        .send({
          entity: 'order',
          entityId: orderId,
          rating: 5,
          comment: 'Great!',
        })
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
      const reviews = asSuccess<{ rating: number; comment?: string }[]>(
        res.body,
      );
      expect(
        reviews.some((r) => r.rating === 5 && r.comment === 'Great!'),
      ).toBe(true);
    });
  });

  describe('quotes: list, detail, and signing', () => {
    let slug: string;
    let organizationId: string;
    let staffToken: string;
    let customerToken: string;
    let otherCustomerToken: string;
    let quoteId: string;

    beforeAll(async () => {
      const authRes = await request(server)
        .post('/api/v1/auth/register')
        .send({ email: 'owner-cust-8@example.com', password: 'password123' })
        .expect(201);
      staffToken = asSuccess<AuthPayload>(authRes.body).accessToken;

      const orgRes = await request(server)
        .post('/api/v1/organizations')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          name: 'Cust Auth Org 8',
          type: 'services',
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
        .send({ enabledModules: ['crm', 'catalog', 'finance'] })
        .expect(200);

      const contactRes = await request(server)
        .post('/api/v1/contacts')
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'person',
          firstName: 'Quote',
          email: 'quote-customer@example.com',
        })
        .expect(201);
      const contactId = asSuccess<{ id: string }>(contactRes.body).id;

      const quoteRes = await request(server)
        .post('/api/v1/quotes')
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          items: [{ description: 'Consulting', quantity: 1, unitPrice: 500 }],
          currency: 'EUR',
        })
        .expect(201);
      quoteId = asSuccess<{ id: string }>(quoteRes.body).id;
      await request(server)
        .post(`/api/v1/quotes/${quoteId}/send`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      const custRes = await request(server)
        .post(`/api/v1/public/${slug}/account/register`)
        .send({
          email: 'quote-customer@example.com',
          password: 'clientpass123',
        })
        .expect(201);
      customerToken = asSuccess<CustomerAuthPayload>(custRes.body).accessToken;

      const otherRes = await request(server)
        .post(`/api/v1/public/${slug}/account/register`)
        .send({
          email: 'other-quote-customer@example.com',
          password: 'clientpass123',
        })
        .expect(201);
      otherCustomerToken = asSuccess<CustomerAuthPayload>(
        otherRes.body,
      ).accessToken;
    });

    it("lists the customer's own quotes", async () => {
      const res = await request(server)
        .get(`/api/v1/public/${slug}/account/quotes`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);
      expect(asSuccess<unknown[]>(res.body)).toHaveLength(1);
    });

    it('returns an empty list for a customer with no quotes', async () => {
      const res = await request(server)
        .get(`/api/v1/public/${slug}/account/quotes`)
        .set('Authorization', `Bearer ${otherCustomerToken}`)
        .expect(200);
      expect(asSuccess<unknown[]>(res.body)).toHaveLength(0);
    });

    it('returns quote detail with line items', async () => {
      const res = await request(server)
        .get(`/api/v1/public/${slug}/account/quotes/${quoteId}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);
      const quote = asSuccess<{ status: string; items: unknown[] }>(res.body);
      expect(quote.status).toBe('sent');
      expect(quote.items).toHaveLength(1);
    });

    it("404s another customer's quote detail", async () => {
      await request(server)
        .get(`/api/v1/public/${slug}/account/quotes/${quoteId}`)
        .set('Authorization', `Bearer ${otherCustomerToken}`)
        .expect(404);
    });

    it('rejects signing by another customer', async () => {
      await request(server)
        .post(`/api/v1/public/${slug}/account/quotes/${quoteId}/sign`)
        .set('Authorization', `Bearer ${otherCustomerToken}`)
        .send({ signerName: 'Someone Else' })
        .expect(404);
    });

    it('signs the quote and records the signer name + timestamp', async () => {
      const res = await request(server)
        .post(`/api/v1/public/${slug}/account/quotes/${quoteId}/sign`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ signerName: 'Quote Customer' })
        .expect(201);
      const quote = asSuccess<{
        status: string;
        signedByName?: string;
        signedAt?: string;
      }>(res.body);
      expect(quote.status).toBe('accepted');
      expect(quote.signedByName).toBe('Quote Customer');
      expect(quote.signedAt).toBeDefined();
    });

    it('rejects signing an already-accepted quote', async () => {
      const res = await request(server)
        .post(`/api/v1/public/${slug}/account/quotes/${quoteId}/sign`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ signerName: 'Quote Customer' })
        .expect(400);
      expect(asError(res.body).code).toBe('QUOTE_INVALID_TRANSITION');
    });

    it('reflects the signature on the detail view', async () => {
      const res = await request(server)
        .get(`/api/v1/public/${slug}/account/quotes/${quoteId}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);
      const quote = asSuccess<{ status: string; signedByName?: string }>(
        res.body,
      );
      expect(quote.status).toBe('accepted');
      expect(quote.signedByName).toBe('Quote Customer');
    });
  });
});
