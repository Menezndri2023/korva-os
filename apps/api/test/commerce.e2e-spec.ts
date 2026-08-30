import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { OrdersRepository } from '../src/commerce/orders/orders.repository';

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
interface OrderItemPayload {
  offerId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
}
interface OrderPayload {
  id: string;
  status: string;
  source: string;
  total: number;
  subtotal: number;
  invoiceId?: string;
  bookingId?: string;
  items: OrderItemPayload[];
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
  paymentStatus?: string;
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

async function waitFor<T>(
  check: () => Promise<T | undefined>,
  timeoutMs = 15000,
  intervalMs = 300,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result !== undefined) return result;
    if (Date.now() > deadline) {
      throw new Error('waitFor: timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
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

    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        enabledModules: ['crm', 'catalog', 'booking', 'commerce', 'finance'],
      })
      .expect(200);

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

  describe('Booking.paymentStatus synced from the real Payment pipeline (docs/BUSINESS_OS_AUDIT.md §2 — "Réservation → Paiement")', () => {
    async function setUpBookingOrderInvoice(
      contactId: string,
      accessToken: string,
      organizationId: string,
    ) {
      const offerRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'booking',
          name: 'Spa session',
          pricing: { amount: 100, currency: 'EUR' },
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
      const bookingId = asSuccess<BookingPayload>(bookingRes.body).id;
      expect(asSuccess<BookingPayload>(bookingRes.body).paymentStatus).toBe(
        'unpaid',
      );

      const orderRes = await request(server)
        .post('/api/v1/orders/from-booking')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ bookingId })
        .expect(201);
      const orderId = asSuccess<OrderPayload>(orderRes.body).id;

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
      const invoiceId = asSuccess<InvoicePayload>(invoiceRes.body).id;

      // A freshly generated invoice starts as 'draft' — POST /payments rejects a draft invoice
      // with INVOICE_NOT_PAYABLE, so it must be issued first, same as a staff member would do.
      await request(server)
        .post(`/api/v1/invoices/${invoiceId}/issue`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      return { bookingId, invoiceId };
    }

    async function getBookingPaymentStatus(
      accessToken: string,
      organizationId: string,
      bookingId: string,
    ): Promise<string> {
      const res = await request(server)
        .get(`/api/v1/bookings/${bookingId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      return asSuccess<BookingPayload>(res.body).paymentStatus!;
    }

    it('moves to "paid" once the booking\'s generated invoice is paid in full', async () => {
      const ctx = await registerOrgContact(
        'booking-payment-full@korva.test',
        'Booking Payment Full Org',
      );
      const { bookingId, invoiceId } = await setUpBookingOrderInvoice(
        ctx.contactId,
        ctx.accessToken,
        ctx.organizationId,
      );

      await request(server)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${ctx.accessToken}`)
        .set('X-Organization-Id', ctx.organizationId)
        .send({ invoiceId, amount: 100, method: 'cash' })
        .expect(201);

      const paymentStatus = await waitFor(async () => {
        const status = await getBookingPaymentStatus(
          ctx.accessToken,
          ctx.organizationId,
          bookingId,
        );
        return status === 'paid' ? status : undefined;
      });
      expect(paymentStatus).toBe('paid');
    });

    it('moves to "deposit_paid" (not "paid") once only part of the invoice has been paid', async () => {
      const ctx = await registerOrgContact(
        'booking-payment-deposit@korva.test',
        'Booking Payment Deposit Org',
      );
      const { bookingId, invoiceId } = await setUpBookingOrderInvoice(
        ctx.contactId,
        ctx.accessToken,
        ctx.organizationId,
      );

      await request(server)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${ctx.accessToken}`)
        .set('X-Organization-Id', ctx.organizationId)
        .send({ invoiceId, amount: 40, method: 'cash' })
        .expect(201);

      const paymentStatus = await waitFor(async () => {
        const status = await getBookingPaymentStatus(
          ctx.accessToken,
          ctx.organizationId,
          bookingId,
        );
        return status === 'deposit_paid' ? status : undefined;
      });
      expect(paymentStatus).toBe('deposit_paid');
    });
  });

  describe('generateInvoice() Order/Invoice MongoDB transaction integrity', () => {
    async function createConfirmedOrder(
      accessToken: string,
      organizationId: string,
      contactId: string,
    ): Promise<string> {
      const orderRes = await request(server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          currency: 'EUR',
          items: [{ description: 'Service', quantity: 1, unitPrice: 150 }],
        })
        .expect(201);
      const orderId = asSuccess<OrderPayload>(orderRes.body).id;

      await request(server)
        .post(`/api/v1/orders/${orderId}/confirm`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      return orderId;
    }

    async function listInvoices(
      accessToken: string,
      organizationId: string,
    ): Promise<InvoicePayload[]> {
      const res = await request(server)
        .get('/api/v1/invoices')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      // ResponseInterceptor flattens paginated results to { success, data: [...], pagination }
      // rather than nesting — data IS the array directly, not { data: { data: [...] } }.
      return asSuccess<InvoicePayload[]>(res.body);
    }

    it('two concurrent generateInvoice() calls for the same order: exactly one Invoice is created, Order.invoiceId points to it, the loser gets ORDER_ALREADY_INVOICED', async () => {
      const { accessToken, organizationId, contactId } =
        await registerOrgContact(
          'invoice-race-owner@korva.test',
          'Invoice Race Org',
        );
      const orderId = await createConfirmedOrder(
        accessToken,
        organizationId,
        contactId,
      );

      // Dispatched before either is awaited — a genuine race against the same order, not two
      // sequential calls. Before this fix, both could read invoiceId=undefined via the same
      // stale Order snapshot and both create an Invoice, leaving one orphaned and/or the Order
      // pointing at only one of the two.
      const [resA, resB] = await Promise.all([
        request(server)
          .post(`/api/v1/orders/${orderId}/generate-invoice`)
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId),
        request(server)
          .post(`/api/v1/orders/${orderId}/generate-invoice`)
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId),
      ]);

      const results = [resA, resB];
      const succeeded = results.filter((r) => r.status === 201);
      const rejected = results.filter((r) => r.status === 400);
      expect(succeeded).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(asError(rejected[0]!.body).code).toBe('ORDER_ALREADY_INVOICED');

      const winningInvoice = asSuccess<InvoicePayload>(succeeded[0]!.body);
      expect(winningInvoice.orderId).toBe(orderId);

      const invoices = await listInvoices(accessToken, organizationId);
      expect(invoices).toHaveLength(1);
      expect(invoices[0]!.id).toBe(winningInvoice.id);

      const orderRes = await request(server)
        .get(`/api/v1/orders/${orderId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<OrderPayload>(orderRes.body).invoiceId).toBe(
        winningInvoice.id,
      );
    });

    it('retrying generateInvoice() after a successful generation does not create a second invoice', async () => {
      const { accessToken, organizationId, contactId } =
        await registerOrgContact(
          'invoice-retry-owner@korva.test',
          'Invoice Retry Org',
        );
      const orderId = await createConfirmedOrder(
        accessToken,
        organizationId,
        contactId,
      );

      const firstRes = await request(server)
        .post(`/api/v1/orders/${orderId}/generate-invoice`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      const invoice = asSuccess<InvoicePayload>(firstRes.body);

      const secondRes = await request(server)
        .post(`/api/v1/orders/${orderId}/generate-invoice`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(400);
      expect(asError(secondRes.body).code).toBe('ORDER_ALREADY_INVOICED');

      const invoices = await listInvoices(accessToken, organizationId);
      expect(invoices).toHaveLength(1);

      const orderRes = await request(server)
        .get(`/api/v1/orders/${orderId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<OrderPayload>(orderRes.body).invoiceId).toBe(invoice.id);
    });

    it('aborts the whole transaction when attaching the Invoice to the Order fails after the Invoice was staged — no Invoice persists, Order.invoiceId stays unset, and a retry succeeds normally', async () => {
      const { accessToken, organizationId, contactId } =
        await registerOrgContact(
          'invoice-rollback-owner@korva.test',
          'Invoice Rollback Org',
        );
      const orderId = await createConfirmedOrder(
        accessToken,
        organizationId,
        contactId,
      );

      // Real MongoDB transaction, real HTTP layer, real atomic Order guard — the only thing
      // faked is a failure injected at the "attach invoice to order" step, i.e. AFTER the
      // Invoice was created inside the transaction but BEFORE commit.
      const ordersRepository = app.get(OrdersRepository);
      const spy = jest
        .spyOn(ordersRepository, 'attachInvoiceIfUnset')
        .mockImplementationOnce(() => {
          throw new Error(
            'deliberate failure to prove generateInvoice transaction rollback',
          );
        });

      try {
        const res = await request(server)
          .post(`/api/v1/orders/${orderId}/generate-invoice`)
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId);
        expect(res.status).toBe(500);
        expect(asError(res.body).code).toBe('INTERNAL_SERVER_ERROR');
      } finally {
        spy.mockRestore();
      }

      // The staged Invoice insert must have been rolled back with the rest of the
      // transaction — not left as an orphan with no Order pointing to it.
      const invoicesAfterAbort = await listInvoices(
        accessToken,
        organizationId,
      );
      expect(invoicesAfterAbort).toHaveLength(0);

      const orderAfterAbortRes = await request(server)
        .get(`/api/v1/orders/${orderId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const orderAfterAbort = asSuccess<OrderPayload>(orderAfterAbortRes.body);
      expect(orderAfterAbort.invoiceId).toBeUndefined();
      expect(orderAfterAbort.status).toBe('confirmed');

      // And a retry right after proves the order wasn't left in some corrupted intermediate
      // state by the aborted attempt.
      const retryRes = await request(server)
        .post(`/api/v1/orders/${orderId}/generate-invoice`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      const invoice = asSuccess<InvoicePayload>(retryRes.body);

      const invoicesAfterRetry = await listInvoices(
        accessToken,
        organizationId,
      );
      expect(invoicesAfterRetry).toHaveLength(1);
      expect(invoicesAfterRetry[0]!.id).toBe(invoice.id);

      const finalOrderRes = await request(server)
        .get(`/api/v1/orders/${orderId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<OrderPayload>(finalOrderRes.body).invoiceId).toBe(
        invoice.id,
      );
    });
  });

  describe('createFromCart() Order/Cart MongoDB transaction integrity', () => {
    async function createOpenCartWithItem(
      accessToken: string,
      organizationId: string,
      contactId: string,
    ): Promise<{ cartId: string; offerId: string }> {
      const offerRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'product',
          name: 'Race Item',
          pricing: { amount: 25, currency: 'EUR' },
        })
        .expect(201);
      const offerId = asSuccess<OfferPayload>(offerRes.body).id;

      const cartRes = await request(server)
        .get(`/api/v1/carts?contactId=${contactId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const cartId = asSuccess<CartPayload>(cartRes.body).id;

      await request(server)
        .post(`/api/v1/carts/${cartId}/items`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ offerId, quantity: 1 })
        .expect(201);

      return { cartId, offerId };
    }

    async function listCartOrders(
      accessToken: string,
      organizationId: string,
      contactId: string,
    ): Promise<OrderPayload[]> {
      const res = await request(server)
        .get(`/api/v1/orders?contactId=${contactId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      // ResponseInterceptor flattens paginated results to { success, data: [...], pagination }.
      return asSuccess<OrderPayload[]>(res.body).filter(
        (order) => order.source === 'cart',
      );
    }

    it('two concurrent checkout() calls for the same cart: exactly one Order is created, the Cart becomes converted, the loser gets CART_NOT_OPEN', async () => {
      const { accessToken, organizationId, contactId } =
        await registerOrgContact(
          'cart-checkout-race-owner@korva.test',
          'Cart Checkout Race Org',
        );
      const { cartId } = await createOpenCartWithItem(
        accessToken,
        organizationId,
        contactId,
      );

      // Dispatched before either is awaited — a genuine race against the same cart, not two
      // sequential calls. Before this fix, both could read status='open' via the same stale
      // Cart snapshot and both create an Order, leaving the Cart converted with two Orders (or
      // an Order with the Cart never actually marked converted).
      const [resA, resB] = await Promise.all([
        request(server)
          .post(`/api/v1/carts/${cartId}/checkout`)
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId),
        request(server)
          .post(`/api/v1/carts/${cartId}/checkout`)
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId),
      ]);

      const results = [resA, resB];
      const succeeded = results.filter((r) => r.status === 201);
      const rejected = results.filter((r) => r.status === 400);
      expect(succeeded).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(asError(rejected[0]!.body).code).toBe('CART_NOT_OPEN');

      const winningOrder = asSuccess<OrderPayload>(succeeded[0]!.body);
      expect(winningOrder.source).toBe('cart');

      const cartOrders = await listCartOrders(
        accessToken,
        organizationId,
        contactId,
      );
      expect(cartOrders).toHaveLength(1);
      expect(cartOrders[0]!.id).toBe(winningOrder.id);

      const cartRes = await request(server)
        .get(`/api/v1/carts/${cartId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<CartPayload>(cartRes.body).status).toBe('converted');
    });

    it('aborts the whole transaction when creating the Order fails after the Cart was staged as converted — no Order persists, the Cart stays open, and a retry succeeds normally', async () => {
      const { accessToken, organizationId, contactId } =
        await registerOrgContact(
          'cart-checkout-rollback-owner@korva.test',
          'Cart Checkout Rollback Org',
        );
      const { cartId } = await createOpenCartWithItem(
        accessToken,
        organizationId,
        contactId,
      );

      // Real MongoDB transaction, real HTTP layer, real atomic Cart guard — the only thing
      // faked is a failure injected at the "insert the Order" step, i.e. AFTER the Cart was
      // staged 'converted' inside the transaction but BEFORE commit.
      const ordersRepository = app.get(OrdersRepository);
      const spy = jest
        .spyOn(ordersRepository, 'create')
        .mockImplementationOnce(() => {
          throw new Error(
            'deliberate failure to prove createFromCart transaction rollback',
          );
        });

      try {
        const res = await request(server)
          .post(`/api/v1/carts/${cartId}/checkout`)
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId);
        expect(res.status).toBe(500);
        expect(asError(res.body).code).toBe('INTERNAL_SERVER_ERROR');
      } finally {
        spy.mockRestore();
      }

      // The staged Cart conversion must have been rolled back with the rest of the
      // transaction — not left 'converted' with no Order behind it.
      const ordersAfterAbort = await listCartOrders(
        accessToken,
        organizationId,
        contactId,
      );
      expect(ordersAfterAbort).toHaveLength(0);

      const cartAfterAbortRes = await request(server)
        .get(`/api/v1/carts/${cartId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<CartPayload>(cartAfterAbortRes.body).status).toBe(
        'open',
      );

      // And a retry right after proves the cart wasn't left in some corrupted intermediate
      // state by the aborted attempt.
      const retryRes = await request(server)
        .post(`/api/v1/carts/${cartId}/checkout`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      const order = asSuccess<OrderPayload>(retryRes.body);
      expect(order.source).toBe('cart');

      const cartAfterRetryRes = await request(server)
        .get(`/api/v1/carts/${cartId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<CartPayload>(cartAfterRetryRes.body).status).toBe(
        'converted',
      );
    });
  });

  describe('open order ("tab") — Restaurant vertical flagship feature', () => {
    let accessToken: string;
    let organizationId: string;
    let contactId: string;
    let starterOfferId: string;
    let dessertOfferId: string;

    beforeAll(async () => {
      const ctx = await registerOrgContact(
        'open-order-owner@korva.test',
        'Open Order Org',
      );
      accessToken = ctx.accessToken;
      organizationId = ctx.organizationId;
      contactId = ctx.contactId;

      const starterRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'product',
          name: 'Salade César',
          pricing: { amount: 12, currency: 'EUR' },
        })
        .expect(201);
      starterOfferId = asSuccess<OfferPayload>(starterRes.body).id;

      const dessertRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'product',
          name: 'Tarte au citron',
          pricing: { amount: 8, currency: 'EUR' },
        })
        .expect(201);
      dessertOfferId = asSuccess<OfferPayload>(dessertRes.body).id;
    });

    async function openTab(): Promise<OrderPayload> {
      const res = await request(server)
        .post('/api/v1/orders/open')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ contactId, currency: 'EUR' })
        .expect(201);
      return asSuccess<OrderPayload>(res.body);
    }

    it('opens an empty tab, accumulates items over time with correctly recomputed totals, then a removal', async () => {
      const order = await openTab();
      expect(order.status).toBe('open');
      expect(order.items).toHaveLength(0);
      expect(order.total).toBe(0);

      const afterStarterRes = await request(server)
        .post(`/api/v1/orders/${order.id}/items`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ offerId: starterOfferId, quantity: 1 })
        .expect(201);
      const afterStarter = asSuccess<OrderPayload>(afterStarterRes.body);
      expect(afterStarter.items).toHaveLength(1);
      expect(afterStarter.total).toBe(12);

      // 20 minutes later, dessert is ordered — this is the whole point of the feature: a
      // second round of items on the SAME order, not a brand new one.
      const afterDessertRes = await request(server)
        .post(`/api/v1/orders/${order.id}/items`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ offerId: dessertOfferId, quantity: 2 })
        .expect(201);
      const afterDessert = asSuccess<OrderPayload>(afterDessertRes.body);
      expect(afterDessert.items).toHaveLength(2);
      expect(afterDessert.total).toBe(12 + 8 * 2);

      const afterRemovalRes = await request(server)
        .delete(`/api/v1/orders/${order.id}/items/0`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const afterRemoval = asSuccess<OrderPayload>(afterRemovalRes.body);
      expect(afterRemoval.items).toHaveLength(1);
      expect(afterRemoval.items[0]!.description).toBe('Tarte au citron');
      expect(afterRemoval.total).toBe(16);
    });

    it('rejects adding/removing items once the tab is closed, and rejects closing an empty tab', async () => {
      const emptyOrder = await openTab();
      const closeEmptyRes = await request(server)
        .post(`/api/v1/orders/${emptyOrder.id}/close`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(400);
      expect(asError(closeEmptyRes.body).code).toBe('ORDER_EMPTY');

      const order = await openTab();
      await request(server)
        .post(`/api/v1/orders/${order.id}/items`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ offerId: starterOfferId, quantity: 1 })
        .expect(201);

      const closeRes = await request(server)
        .post(`/api/v1/orders/${order.id}/close`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      expect(asSuccess<OrderPayload>(closeRes.body).status).toBe('pending');

      const addAfterCloseRes = await request(server)
        .post(`/api/v1/orders/${order.id}/items`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ offerId: dessertOfferId, quantity: 1 })
        .expect(400);
      expect(asError(addAfterCloseRes.body).code).toBe('ORDER_NOT_OPEN');

      const removeAfterCloseRes = await request(server)
        .delete(`/api/v1/orders/${order.id}/items/0`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(400);
      expect(asError(removeAfterCloseRes.body).code).toBe('ORDER_NOT_OPEN');
    });

    it('a closed tab flows through the existing, unmodified confirm → fulfill → generate-invoice pipeline', async () => {
      const order = await openTab();
      await request(server)
        .post(`/api/v1/orders/${order.id}/items`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ offerId: starterOfferId, quantity: 1 })
        .expect(201);
      await request(server)
        .post(`/api/v1/orders/${order.id}/close`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      await request(server)
        .post(`/api/v1/orders/${order.id}/confirm`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      const fulfillRes = await request(server)
        .post(`/api/v1/orders/${order.id}/fulfill`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      expect(asSuccess<OrderPayload>(fulfillRes.body).status).toBe('fulfilled');

      const invoiceRes = await request(server)
        .post(`/api/v1/orders/${order.id}/generate-invoice`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      expect(asSuccess<InvoicePayload>(invoiceRes.body).total).toBe(12);
    });

    it('rejects opening a second tab for a booking that already has one open', async () => {
      const resourceRes = await request(server)
        .post('/api/v1/resources')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'Table 5',
          type: 'table',
          capacity: 1,
          weeklyAvailability: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
            dayOfWeek,
            startTime: '00:00',
            endTime: '23:59',
          })),
        })
        .expect(201);
      const resourceId = asSuccess<ResourcePayload>(resourceRes.body).id;

      const bookingRes = await request(server)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          resourceId,
          offerId: starterOfferId,
          contactId,
          startAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          endAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        })
        .expect(201);
      const bookingId = asSuccess<BookingPayload>(bookingRes.body).id;

      await request(server)
        .post('/api/v1/orders/open')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ contactId, currency: 'EUR', bookingId })
        .expect(201);

      const secondRes = await request(server)
        .post('/api/v1/orders/open')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ contactId, currency: 'EUR', bookingId })
        .expect(400);
      expect(asError(secondRes.body).code).toBe('ORDER_ALREADY_EXISTS');
    });

    it('denies a STAFF member (no orders.update) from adding items or closing a tab, while orders.create still allows opening one', async () => {
      const staffAuthRes = await request(server)
        .post('/api/v1/auth/register')
        .send({
          email: 'open-order-staff@korva.test',
          password: 'password123',
        })
        .expect(201);
      const staffToken = asSuccess<AuthPayload>(staffAuthRes.body).accessToken;
      const staffRole = await connection.collection('roles').findOne({
        organizationId: new Types.ObjectId(organizationId),
        systemKey: 'STAFF',
      });
      await request(server)
        .post('/api/v1/organizations/me/members')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          email: 'open-order-staff@korva.test',
          roleId: String(staffRole?._id),
        })
        .expect(201);

      const order = await openTab();

      const addAsStaffRes = await request(server)
        .post(`/api/v1/orders/${order.id}/items`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ offerId: starterOfferId, quantity: 1 })
        .expect(403);
      expect(asError(addAsStaffRes.body).code).toBe('PERMISSION_DENIED');

      const closeAsStaffRes = await request(server)
        .post(`/api/v1/orders/${order.id}/close`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(403);
      expect(asError(closeAsStaffRes.body).code).toBe('PERMISSION_DENIED');
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

    it("denies reading another organization's cart by its real id, even with a valid token for the caller's own organization", async () => {
      const a = await registerOrgContact(
        'commerce-iso-cart-a@korva.test',
        'Commerce Iso Cart A',
      );
      const b = await registerOrgContact(
        'commerce-iso-cart-b@korva.test',
        'Commerce Iso Cart B',
      );

      // Real cart, created in B via the normal get-or-create endpoint — not a direct Mongo
      // insert. Its id is the one an attacker in A would have to already know or guess.
      const cartRes = await request(server)
        .get(`/api/v1/carts?contactId=${b.contactId}`)
        .set('Authorization', `Bearer ${b.accessToken}`)
        .set('X-Organization-Id', b.organizationId)
        .expect(200);
      const cartId = asSuccess<CartPayload>(cartRes.body).id;

      // A's own token, A's own (valid) X-Organization-Id header — this is not the
      // ORGANIZATION_ACCESS_DENIED case above (a foreign header rejected by TenantGuard before
      // reaching the controller); it proves CartsRepository.findById itself is scoped by
      // organizationId, not just by the cart's _id.
      const res = await request(server)
        .get(`/api/v1/carts/${cartId}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Organization-Id', a.organizationId)
        .expect(404);
      expect(asError(res.body).code).toBe('CART_NOT_FOUND');
    });
  });
});
