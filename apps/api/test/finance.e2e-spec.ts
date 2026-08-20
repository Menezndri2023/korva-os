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
interface QuotePayload {
  id: string;
  status: string;
  total: number;
}
interface InvoicePayload {
  id: string;
  status: string;
  total: number;
  amountPaid: number;
  quoteId?: string;
}
interface PaymentPayload {
  id: string;
  status: string;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

describe('Finance module (e2e)', () => {
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

  async function registerOrgAndContact(email: string, orgName: string) {
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
        type: 'service',
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
      .send({ firstName: 'Client', lastName: 'Test' })
      .expect(201);
    const contactId = asSuccess<ContactPayload>(contactRes.body).id;

    return { accessToken, organizationId, contactId };
  }

  describe('quote lifecycle and totals', () => {
    let accessToken: string;
    let organizationId: string;
    let contactId: string;
    let quoteId: string;

    beforeAll(async () => {
      ({ accessToken, organizationId, contactId } = await registerOrgAndContact(
        'quote-owner@korva.test',
        'Quote Org',
      ));
    });

    it('computes subtotal/tax/total server-side from the line items, ignoring any client-sent totals', async () => {
      const res = await request(server)
        .post('/api/v1/quotes')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          currency: 'EUR',
          items: [
            {
              description: 'Consulting',
              quantity: 2,
              unitPrice: 100,
              taxRate: 20,
            },
          ],
          // Deliberately sent — the server must ignore any client-supplied total and recompute it.
          total: 999999,
        })
        .expect(201);
      const quote = asSuccess<QuotePayload>(res.body);
      quoteId = quote.id;
      expect(quote.status).toBe('draft');
      expect(quote.total).toBe(240);
    });

    it('rejects editing a quote that already left draft', async () => {
      await request(server)
        .post(`/api/v1/quotes/${quoteId}/send`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      const res = await request(server)
        .patch(`/api/v1/quotes/${quoteId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ notes: 'too late' })
        .expect(400);
      expect(asError(res.body).code).toBe('QUOTE_NOT_EDITABLE');
    });

    it('rejects accepting a quote that is still in draft (invalid transition)', async () => {
      const draftRes = await request(server)
        .post('/api/v1/quotes')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          currency: 'EUR',
          items: [{ description: 'Other', quantity: 1, unitPrice: 10 }],
        })
        .expect(201);
      const draftId = asSuccess<QuotePayload>(draftRes.body).id;

      const res = await request(server)
        .post(`/api/v1/quotes/${draftId}/accept`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(400);
      expect(asError(res.body).code).toBe('QUOTE_INVALID_TRANSITION');
    });

    it('accepts the sent quote and converts it to an invoice carrying the same totals', async () => {
      await request(server)
        .post(`/api/v1/quotes/${quoteId}/accept`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      const res = await request(server)
        .post(`/api/v1/quotes/${quoteId}/convert-to-invoice`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      const invoice = asSuccess<InvoicePayload>(res.body);
      expect(invoice.quoteId).toBe(quoteId);
      expect(invoice.total).toBe(240);
      expect(invoice.status).toBe('draft');
    });
  });

  describe('invoice payments and refunds', () => {
    let accessToken: string;
    let organizationId: string;
    let contactId: string;
    let invoiceId: string;
    let paymentId: string;

    beforeAll(async () => {
      const ctx = await registerOrgAndContact(
        'payments-owner@korva.test',
        'Payments Org',
      );
      accessToken = ctx.accessToken;
      organizationId = ctx.organizationId;
      contactId = ctx.contactId;

      const invoiceRes = await request(server)
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          currency: 'EUR',
          items: [{ description: 'Service', quantity: 1, unitPrice: 240 }],
        })
        .expect(201);
      invoiceId = asSuccess<InvoicePayload>(invoiceRes.body).id;

      await request(server)
        .post(`/api/v1/invoices/${invoiceId}/issue`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
    });

    it('rejects a payment against a draft invoice', async () => {
      const draftRes = await request(server)
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          currency: 'EUR',
          items: [{ description: 'Draft item', quantity: 1, unitPrice: 10 }],
        })
        .expect(201);
      const draftInvoiceId = asSuccess<InvoicePayload>(draftRes.body).id;

      const res = await request(server)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ invoiceId: draftInvoiceId, amount: 10 })
        .expect(400);
      expect(asError(res.body).code).toBe('INVOICE_NOT_PAYABLE');
    });

    it('accepts a partial payment and marks the invoice partially_paid', async () => {
      const res = await request(server)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ invoiceId, amount: 100, method: 'cash' })
        .expect(201);
      const payment = asSuccess<PaymentPayload>(res.body);
      paymentId = payment.id;
      expect(payment.status).toBe('completed');

      const invoiceRes = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const invoice = asSuccess<InvoicePayload>(invoiceRes.body);
      expect(invoice.status).toBe('partially_paid');
      expect(invoice.amountPaid).toBe(100);
    });

    it('rejects a payment that would exceed the remaining balance', async () => {
      const res = await request(server)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ invoiceId, amount: 500 })
        .expect(400);
      expect(asError(res.body).code).toBe('PAYMENT_EXCEEDS_BALANCE');
    });

    it('marks the invoice paid once the balance is fully settled', async () => {
      await request(server)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ invoiceId, amount: 140, method: 'transfer' })
        .expect(201);

      const invoiceRes = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<InvoicePayload>(invoiceRes.body).status).toBe('paid');
    });

    it('partially refunds the first payment (60 of 100) and reopens the invoice balance', async () => {
      const res = await request(server)
        .post('/api/v1/payments/refunds')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ paymentId, amount: 60, reason: 'goodwill' })
        .expect(201);
      expect(asSuccess<{ amount: number }>(res.body).amount).toBe(60);

      const invoiceRes = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const invoice = asSuccess<InvoicePayload>(invoiceRes.body);
      expect(invoice.status).toBe('partially_paid');
      expect(invoice.amountPaid).toBe(180);
    });

    it('rejects refunding more than what remains refundable on the payment (40 left of the 100)', async () => {
      const res = await request(server)
        .post('/api/v1/payments/refunds')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ paymentId, amount: 50 })
        .expect(400);
      expect(asError(res.body).code).toBe('REFUND_EXCEEDS_PAYMENT');
    });

    it('fully refunds the remaining 40 and marks the payment refunded', async () => {
      await request(server)
        .post('/api/v1/payments/refunds')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ paymentId, amount: 40 })
        .expect(201);

      const res = await request(server)
        .post('/api/v1/payments/refunds')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ paymentId, amount: 1 })
        .expect(400);
      expect(asError(res.body).code).toBe('PAYMENT_NOT_REFUNDABLE');
    });
  });

  describe('tenant isolation for finance resources', () => {
    it('denies a user from another organization reading quotes via a foreign org id', async () => {
      const a = await registerOrgAndContact(
        'finance-iso-a@korva.test',
        'Finance Iso A',
      );
      const b = await registerOrgAndContact(
        'finance-iso-b@korva.test',
        'Finance Iso B',
      );

      await request(server)
        .post('/api/v1/quotes')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Organization-Id', a.organizationId)
        .send({
          contactId: a.contactId,
          currency: 'EUR',
          items: [{ description: 'Secret', quantity: 1, unitPrice: 1 }],
        })
        .expect(201);

      const res = await request(server)
        .get('/api/v1/quotes')
        .set('Authorization', `Bearer ${b.accessToken}`)
        .set('X-Organization-Id', a.organizationId)
        .expect(403);
      expect(asError(res.body).code).toBe('ORGANIZATION_ACCESS_DENIED');
    });
  });
});
