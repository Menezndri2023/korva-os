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
interface CartItemPayload {
  id: string;
  offerId: string;
  quantity: number;
}
interface CartPayload {
  id: string;
  status: string;
  items: CartItemPayload[];
}
interface OrderPayload {
  id: string;
  status: string;
  source: string;
  total: number;
  invoiceId?: string;
  bookingId?: string;
}
interface InvoicePayload {
  id: string;
  orderId?: string;
  total: number;
}
interface ResourcePayload {
  id: string;
}
interface BookingPayload {
  id: string;
}
interface FulfillmentPayload {
  status: string;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

function nextDateFor(dayOfWeek: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 7);
  while (date.getUTCDay() !== dayOfWeek) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}

describe('Commerce module (e2e)', () => {
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

  async function registerOrgContact(email: string, orgName: string) {
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
        type: 'ecommerce',
        country: 'FR',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        language: 'fr',
      })
      .expect(201);
    const organizationId = asSuccess<OrganizationPayload>(orgRes.body).id;

    const contactRes = await request(server)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ firstName: 'Buyer' })
      .expect(201);
    const contactId = asSuccess<ContactPayload>(contactRes.body).id;

    return { accessToken, organizationId, contactId };
  }

  describe('cart, checkout and order lifecycle', () => {
    let accessToken: string;
    let organizationId: string;
    let contactId: string;
    let offerId: string;
    let cartId: string;
    let orderId: string;

    beforeAll(async () => {
      const ctx = await registerOrgContact(
        'commerce-owner@korva.test',
        'Commerce Org',
      );
      accessToken = ctx.accessToken;
      organizationId = ctx.organizationId;
      contactId = ctx.contactId;

      const offerRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'product',
          name: 'T-Shirt',
          pricing: { amount: 19.99, currency: 'EUR', taxRate: 20 },
        })
        .expect(201);
      offerId = asSuccess<OfferPayload>(offerRes.body).id;
    });

    it('creates a cart on first access and reuses it on subsequent access', async () => {
      const first = await request(server)
        .get(`/api/v1/carts?contactId=${contactId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      cartId = asSuccess<CartPayload>(first.body).id;

      const second = await request(server)
        .get(`/api/v1/carts?contactId=${contactId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<CartPayload>(second.body).id).toBe(cartId);
    });

    it('adds an item and increments its quantity when added again', async () => {
      await request(server)
        .post(`/api/v1/carts/${cartId}/items`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ offerId, quantity: 2 })
        .expect(201);

      const res = await request(server)
        .post(`/api/v1/carts/${cartId}/items`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ offerId, quantity: 1 })
        .expect(201);
      const cart = asSuccess<CartPayload>(res.body);
      expect(cart.items).toHaveLength(1);
      expect(cart.items[0]?.quantity).toBe(3);
    });

    it('checks out the cart into a pending order with server-computed totals', async () => {
      const res = await request(server)
        .post(`/api/v1/carts/${cartId}/checkout`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      const order = asSuccess<OrderPayload>(res.body);
      orderId = order.id;
      expect(order.status).toBe('pending');
      expect(order.source).toBe('cart');
      expect(order.total).toBeCloseTo(71.96, 2);
    });

    it('rejects checking out the same cart again once converted', async () => {
      const res = await request(server)
        .post(`/api/v1/carts/${cartId}/checkout`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(400);
      expect(asError(res.body).code).toBe('CART_NOT_OPEN');
    });

    it('rejects generating an invoice for a pending (unconfirmed) order', async () => {
      const res = await request(server)
        .post(`/api/v1/orders/${orderId}/generate-invoice`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(400);
      expect(asError(res.body).code).toBe('ORDER_NOT_INVOICEABLE');
    });

    it('confirms the order, generates an invoice, then fulfills it', async () => {
      await request(server)
        .post(`/api/v1/orders/${orderId}/confirm`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      const invoiceRes = await request(server)
        .post(`/api/v1/orders/${orderId}/generate-invoice`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      const invoice = asSuccess<InvoicePayload>(invoiceRes.body);
      expect(invoice.orderId).toBe(orderId);
      expect(invoice.total).toBeCloseTo(71.96, 2);

      const secondInvoiceRes = await request(server)
        .post(`/api/v1/orders/${orderId}/generate-invoice`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(400);
      expect(asError(secondInvoiceRes.body).code).toBe(
        'ORDER_ALREADY_INVOICED',
      );

      await request(server)
        .post(`/api/v1/orders/${orderId}/fulfill`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      const fulfillmentRes = await request(server)
        .get(`/api/v1/fulfillments?orderId=${orderId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<FulfillmentPayload>(fulfillmentRes.body).status).toBe(
        'pending',
      );
    });

    it('rejects cancelling a fulfilled order', async () => {
      const res = await request(server)
        .post(`/api/v1/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(400);
      expect(asError(res.body).code).toBe('ORDER_INVALID_TRANSITION');
    });
  });

  describe('order created directly from a booking', () => {
    let accessToken: string;
    let organizationId: string;
    let contactId: string;
    let bookingId: string;

    beforeAll(async () => {
      const ctx = await registerOrgContact(
        'booking-order-owner@korva.test',
        'Booking Order Org',
      );
      accessToken = ctx.accessToken;
      organizationId = ctx.organizationId;
      contactId = ctx.contactId;

      const offerRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'booking',
          name: 'Spa session',
          pricing: { amount: 60, currency: 'EUR' },
        })
        .expect(201);
      const offerId = asSuccess<OfferPayload>(offerRes.body).id;

      const resourceRes = await request(server)
        .post('/api/v1/resources')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'Room A',
          type: 'room',
          weeklyAvailability: [
            { dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },
          ],
        })
        .expect(201);
      const resourceId = asSuccess<ResourcePayload>(resourceRes.body).id;

      const bookingRes = await request(server)
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
      bookingId = asSuccess<BookingPayload>(bookingRes.body).id;
    });

    it('creates an order from the booking, carrying its price', async () => {
      const res = await request(server)
        .post('/api/v1/orders/from-booking')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ bookingId })
        .expect(201);
      const order = asSuccess<OrderPayload>(res.body);
      expect(order.source).toBe('booking');
      expect(order.bookingId).toBe(bookingId);
      expect(order.total).toBe(60);
    });

    it('rejects creating a second order for the same booking', async () => {
      const res = await request(server)
        .post('/api/v1/orders/from-booking')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ bookingId })
        .expect(400);
      expect(asError(res.body).code).toBe('ORDER_ALREADY_EXISTS');
    });
  });

  describe('tenant isolation for commerce resources', () => {
    it('denies a user from another organization reading orders via a foreign org id', async () => {
      const a = await registerOrgContact(
        'commerce-iso-a@korva.test',
        'Commerce Iso A',
      );
      const b = await registerOrgContact(
        'commerce-iso-b@korva.test',
        'Commerce Iso B',
      );

      const offerRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Organization-Id', a.organizationId)
        .send({
          type: 'product',
          name: 'Secret product',
          pricing: { amount: 1, currency: 'EUR' },
        })
        .expect(201);
      const offerId = asSuccess<OfferPayload>(offerRes.body).id;

      await request(server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Organization-Id', a.organizationId)
        .send({
          contactId: a.contactId,
          currency: 'EUR',
          items: [
            { offerId, description: 'Secret', quantity: 1, unitPrice: 1 },
          ],
        })
        .expect(201);

      const res = await request(server)
        .get('/api/v1/orders')
        .set('Authorization', `Bearer ${b.accessToken}`)
        .set('X-Organization-Id', a.organizationId)
        .expect(403);
      expect(asError(res.body).code).toBe('ORGANIZATION_ACCESS_DENIED');
    });
  });
});
