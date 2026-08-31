import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PaymentsRepository } from '../src/finance/payments/payments.repository';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from '../src/finance/payments/providers/payment-provider.interface';

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
  amount: number;
  tipAmount?: number;
  tipStaffMembershipId?: string;
}
interface MemberPayload {
  id: string;
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

    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ enabledModules: ['crm', 'finance'] })
      .expect(200);

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

  describe('quote and invoice PDF export', () => {
    let accessToken: string;
    let organizationId: string;
    let contactId: string;

    beforeAll(async () => {
      ({ accessToken, organizationId, contactId } = await registerOrgAndContact(
        'pdf-owner@korva.test',
        'PDF Org',
      ));
    });

    it('downloads a valid PDF for a quote', async () => {
      const quoteRes = await request(server)
        .post('/api/v1/quotes')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          currency: 'EUR',
          items: [{ description: 'Consulting', quantity: 1, unitPrice: 100 }],
        })
        .expect(201);
      const quoteId = asSuccess<QuotePayload>(quoteRes.body).id;

      const res = await request(server)
        .get(`/api/v1/quotes/${quoteId}/pdf`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(Buffer.isBuffer(res.body)).toBe(true);
      expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('downloads a valid PDF for an invoice', async () => {
      const invoiceRes = await request(server)
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          currency: 'EUR',
          items: [{ description: 'Consulting', quantity: 1, unitPrice: 100 }],
        })
        .expect(201);
      const invoiceId = asSuccess<InvoicePayload>(invoiceRes.body).id;

      const res = await request(server)
        .get(`/api/v1/invoices/${invoiceId}/pdf`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(Buffer.isBuffer(res.body)).toBe(true);
      expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('404s for a quote pdf that does not exist', async () => {
      const res = await request(server)
        .get('/api/v1/quotes/000000000000000000000000/pdf')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(404);
      expect(asError(res.body).code).toBe('QUOTE_NOT_FOUND');
    });
  });

  describe('discount codes', () => {
    let accessToken: string;
    let organizationId: string;
    let contactId: string;

    beforeAll(async () => {
      ({ accessToken, organizationId, contactId } = await registerOrgAndContact(
        'discount-owner@korva.test',
        'Discount Org',
      ));
      // registerOrgAndContact only enables crm/finance — orders (commerce) are also exercised
      // by the discount-code tests below, so enable that module too for this describe block.
      await request(server)
        .patch('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ enabledModules: ['crm', 'finance', 'catalog', 'commerce'] })
        .expect(200);
    });

    it('creates a discount code, normalizing the code to uppercase', async () => {
      const res = await request(server)
        .post('/api/v1/discount-codes')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ code: 'save10', type: 'percentage', value: 10 })
        .expect(201);
      expect(asSuccess<{ code: string }>(res.body).code).toBe('SAVE10');
    });

    it('rejects creating a duplicate code (case-insensitively)', async () => {
      const res = await request(server)
        .post('/api/v1/discount-codes')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ code: 'Save10', type: 'fixed', value: 5, currency: 'EUR' })
        .expect(400);
      expect(asError(res.body).code).toBe('DISCOUNT_CODE_ALREADY_EXISTS');
    });

    it('rejects a fixed-type code with no currency', async () => {
      const res = await request(server)
        .post('/api/v1/discount-codes')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ code: 'NOCURRENCY', type: 'fixed', value: 5 })
        .expect(400);
      expect(asError(res.body).code).toBe('VALIDATION_ERROR');
    });

    it('applies a percentage discount code to a new quote, pre-tax, and rejects an unknown code', async () => {
      const quoteRes = await request(server)
        .post('/api/v1/quotes')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          currency: 'EUR',
          items: [
            {
              description: 'Consulting',
              quantity: 1,
              unitPrice: 100,
              taxRate: 20,
            },
          ],
          discountCode: 'save10',
        })
        .expect(201);
      const quote = asSuccess<
        QuotePayload & {
          discountTotal: number;
          subtotal: number;
          taxTotal: number;
        }
      >(quoteRes.body);
      expect(quote.subtotal).toBe(100);
      expect(quote.taxTotal).toBe(20);
      expect(quote.discountTotal).toBe(10);
      expect(quote.total).toBe(110);

      const badRes = await request(server)
        .post('/api/v1/quotes')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          currency: 'EUR',
          items: [{ description: 'Other', quantity: 1, unitPrice: 10 }],
          discountCode: 'DOES-NOT-EXIST',
        })
        .expect(404);
      expect(asError(badRes.body).code).toBe('DISCOUNT_CODE_NOT_FOUND');
    });

    it('enforces maxRedemptions atomically: the second order with the same single-use code is rejected, and stock/order state is unaffected', async () => {
      await request(server)
        .post('/api/v1/discount-codes')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          code: 'ONEUSE',
          type: 'fixed',
          value: 5,
          currency: 'EUR',
          maxRedemptions: 1,
        })
        .expect(201);

      await request(server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          currency: 'EUR',
          items: [{ description: 'Widget', quantity: 1, unitPrice: 20 }],
          discountCode: 'ONEUSE',
        })
        .expect(201);

      const secondRes = await request(server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          currency: 'EUR',
          items: [{ description: 'Widget', quantity: 1, unitPrice: 20 }],
          discountCode: 'ONEUSE',
        })
        .expect(400);
      expect(asError(secondRes.body).code).toBe('DISCOUNT_CODE_EXHAUSTED');
    });

    it('releases the redemption when the order using it is cancelled', async () => {
      await request(server)
        .post('/api/v1/discount-codes')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          code: 'RELEASEME',
          type: 'fixed',
          value: 5,
          currency: 'EUR',
          maxRedemptions: 1,
        })
        .expect(201);

      const orderRes = await request(server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          currency: 'EUR',
          items: [{ description: 'Widget', quantity: 1, unitPrice: 20 }],
          discountCode: 'RELEASEME',
        })
        .expect(201);
      const orderId = asSuccess<{ id: string }>(orderRes.body).id;

      await request(server)
        .post(`/api/v1/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      // Released — a second order can now use the same single-use code.
      const secondRes = await request(server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          currency: 'EUR',
          items: [{ description: 'Widget', quantity: 1, unitPrice: 20 }],
          discountCode: 'RELEASEME',
        })
        .expect(201);
      expect(
        asSuccess<{ discountTotal: number }>(secondRes.body).discountTotal,
      ).toBe(5);
    });

    it('rejects a scope:"offers" code when none of the order items are eligible', async () => {
      const offerRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'product',
          name: 'Eligible Widget',
          pricing: { amount: 15, currency: 'EUR' },
        })
        .expect(201);
      const eligibleOfferId = asSuccess<{ id: string }>(offerRes.body).id;

      await request(server)
        .post('/api/v1/discount-codes')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          code: 'SCOPED',
          type: 'percentage',
          value: 20,
          scope: 'offers',
          offerIds: [eligibleOfferId],
        })
        .expect(201);

      const ineligibleRes = await request(server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          currency: 'EUR',
          items: [
            { description: 'Unrelated item', quantity: 1, unitPrice: 20 },
          ],
          discountCode: 'SCOPED',
        })
        .expect(400);
      expect(asError(ineligibleRes.body).code).toBe('DISCOUNT_CODE_INELIGIBLE');

      const eligibleRes = await request(server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          currency: 'EUR',
          items: [
            {
              offerId: eligibleOfferId,
              description: 'Eligible Widget',
              quantity: 1,
              unitPrice: 15,
            },
          ],
          discountCode: 'SCOPED',
        })
        .expect(201);
      expect(
        asSuccess<{ discountTotal: number }>(eligibleRes.body).discountTotal,
      ).toBe(3);
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

    it('records a tip alongside a payment, attributed to a staff member, without it counting against the invoice balance', async () => {
      const tipInvoiceRes = await request(server)
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          currency: 'EUR',
          items: [{ description: 'Dinner', quantity: 1, unitPrice: 50 }],
        })
        .expect(201);
      const tipInvoiceId = asSuccess<InvoicePayload>(tipInvoiceRes.body).id;
      await request(server)
        .post(`/api/v1/invoices/${tipInvoiceId}/issue`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      const membersRes = await request(server)
        .get('/api/v1/organizations/me/members')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const staffMembershipId = asSuccess<MemberPayload[]>(membersRes.body)[0]!
        .id;

      const res = await request(server)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          invoiceId: tipInvoiceId,
          amount: 50,
          tipAmount: 8,
          tipStaffMembershipId: staffMembershipId,
        })
        .expect(201);
      const payment = asSuccess<PaymentPayload>(res.body);
      expect(payment.amount).toBe(50);
      expect(payment.tipAmount).toBe(8);
      expect(payment.tipStaffMembershipId).toBe(staffMembershipId);

      // The tip is extra money, not part of what's owed — the invoice is fully paid by the
      // 50 alone, regardless of the 8 tip riding alongside it.
      const invoiceRes = await request(server)
        .get(`/api/v1/invoices/${tipInvoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const invoice = asSuccess<InvoicePayload>(invoiceRes.body);
      expect(invoice.status).toBe('paid');
      expect(invoice.amountPaid).toBe(50);
    });

    it('rejects a payment with a tip attributed to a membership that does not exist', async () => {
      const tipInvoiceRes = await request(server)
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          currency: 'EUR',
          items: [{ description: 'Dinner', quantity: 1, unitPrice: 50 }],
        })
        .expect(201);
      const tipInvoiceId = asSuccess<InvoicePayload>(tipInvoiceRes.body).id;
      await request(server)
        .post(`/api/v1/invoices/${tipInvoiceId}/issue`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      const res = await request(server)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          invoiceId: tipInvoiceId,
          amount: 50,
          tipAmount: 5,
          tipStaffMembershipId: new Types.ObjectId().toString(),
        })
        .expect(404);
      expect(asError(res.body).code).toBe('MEMBERSHIP_NOT_FOUND');
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
        .set('Idempotency-Key', 'refund-partial-60')
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
        .set('Idempotency-Key', 'refund-over-remaining')
        .send({ paymentId, amount: 50 })
        .expect(400);
      expect(asError(res.body).code).toBe('REFUND_EXCEEDS_PAYMENT');
    });

    it('fully refunds the remaining 40 and marks the payment refunded', async () => {
      await request(server)
        .post('/api/v1/payments/refunds')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .set('Idempotency-Key', 'refund-remaining-40')
        .send({ paymentId, amount: 40 })
        .expect(201);

      const res = await request(server)
        .post('/api/v1/payments/refunds')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .set('Idempotency-Key', 'refund-after-fully-refunded')
        .send({ paymentId, amount: 1 })
        .expect(400);
      expect(asError(res.body).code).toBe('PAYMENT_NOT_REFUNDABLE');
    });
  });

  describe('concurrent payments do not race on Invoice.amountPaid', () => {
    it('fires two payments at the same invoice simultaneously and sums both correctly (no lost update)', async () => {
      const { accessToken, organizationId, contactId } =
        await registerOrgAndContact(
          'concurrency-owner@korva.test',
          'Concurrency Org',
        );

      const invoiceRes = await request(server)
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          currency: 'EUR',
          items: [{ description: 'Service', quantity: 1, unitPrice: 300 }],
        })
        .expect(201);
      const invoiceId = asSuccess<InvoicePayload>(invoiceRes.body).id;

      await request(server)
        .post(`/api/v1/invoices/${invoiceId}/issue`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      // Both requests are dispatched before either is awaited — a genuine concurrent race
      // against the same invoice, not two sequential calls. Before the fix, both would read
      // amountPaid=0 and the second write would silently overwrite the first (final=200
      // instead of 300, per the scenario in the audit).
      const [resA, resB] = await Promise.all([
        request(server)
          .post('/api/v1/payments')
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .send({ invoiceId, amount: 100, method: 'cash' }),
        request(server)
          .post('/api/v1/payments')
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .send({ invoiceId, amount: 200, method: 'transfer' }),
      ]);
      expect(resA.status).toBe(201);
      expect(resB.status).toBe(201);

      const finalRes = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const invoice = asSuccess<InvoicePayload>(finalRes.body);
      expect(invoice.amountPaid).toBe(300); // 100 + 200, not one clobbering the other
      expect(invoice.status).toBe('paid');
    });
  });

  describe('PAYMENT_EXCEEDS_BALANCE is enforced atomically, not just on a stale read', () => {
    async function createIssuedInvoice(
      accessToken: string,
      organizationId: string,
      contactId: string,
      total: number,
    ): Promise<string> {
      const invoiceRes = await request(server)
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          currency: 'EUR',
          items: [{ description: 'Service', quantity: 1, unitPrice: total }],
        })
        .expect(201);
      const invoiceId = asSuccess<InvoicePayload>(invoiceRes.body).id;

      await request(server)
        .post(`/api/v1/invoices/${invoiceId}/issue`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      return invoiceId;
    }

    it('two concurrent 200 payments on a 300 invoice: exactly one succeeds, the other gets PAYMENT_EXCEEDS_BALANCE, amountPaid never exceeds 300', async () => {
      const { accessToken, organizationId, contactId } =
        await registerOrgAndContact(
          'balance-race-owner@korva.test',
          'Balance Race Org',
        );
      const invoiceId = await createIssuedInvoice(
        accessToken,
        organizationId,
        contactId,
        300,
      );

      // Dispatched before either is awaited — a genuine race, not two sequential calls. Before
      // this fix, both could read amountPaid=0 via the same stale snapshot and both succeed,
      // landing on amountPaid=400 (per the scenario in the audit).
      const [resA, resB] = await Promise.all([
        request(server)
          .post('/api/v1/payments')
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .send({ invoiceId, amount: 200, method: 'cash' }),
        request(server)
          .post('/api/v1/payments')
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .send({ invoiceId, amount: 200, method: 'transfer' }),
      ]);

      const results = [resA, resB];
      const succeeded = results.filter((r) => r.status === 201);
      const rejected = results.filter((r) => r.status === 400);
      expect(succeeded).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(asError(rejected[0]!.body).code).toBe('PAYMENT_EXCEEDS_BALANCE');

      const finalRes = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const invoice = asSuccess<InvoicePayload>(finalRes.body);
      expect(invoice.amountPaid).toBe(200); // never 400
      expect(invoice.status).toBe('partially_paid');

      // The rejected request must not have created a "completed" Payment record — a lost
      // race must never look like a successful charge.
      const paymentsRes = await request(server)
        .get(`/api/v1/payments?invoiceId=${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const payments = asSuccess<PaymentPayload[]>(paymentsRes.body);
      expect(payments).toHaveLength(1);
      expect(payments[0]!.status).toBe('completed');
    });

    it('normal case: 300 invoice paid as 200 then 100 (not concurrent) reaches amountPaid=300, status=paid', async () => {
      const { accessToken, organizationId, contactId } =
        await registerOrgAndContact(
          'balance-normal-owner@korva.test',
          'Balance Normal Org',
        );
      const invoiceId = await createIssuedInvoice(
        accessToken,
        organizationId,
        contactId,
        300,
      );

      await request(server)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ invoiceId, amount: 200 })
        .expect(201);
      await request(server)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ invoiceId, amount: 100 })
        .expect(201);

      const res = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const invoice = asSuccess<InvoicePayload>(res.body);
      expect(invoice.amountPaid).toBe(300);
      expect(invoice.status).toBe('paid');
    });

    it('exact-amount case: a single 300 payment on a 300 invoice is accepted, amountPaid=300, status=paid', async () => {
      const { accessToken, organizationId, contactId } =
        await registerOrgAndContact(
          'balance-exact-owner@korva.test',
          'Balance Exact Org',
        );
      const invoiceId = await createIssuedInvoice(
        accessToken,
        organizationId,
        contactId,
        300,
      );

      await request(server)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ invoiceId, amount: 300 })
        .expect(201);

      const res = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const invoice = asSuccess<InvoicePayload>(res.body);
      expect(invoice.amountPaid).toBe(300);
      expect(invoice.status).toBe('paid');
    });

    it('sequential overpayment: 200 then 200 on a 300 invoice — first accepted, second rejected, amountPaid=200', async () => {
      const { accessToken, organizationId, contactId } =
        await registerOrgAndContact(
          'balance-sequential-owner@korva.test',
          'Balance Sequential Org',
        );
      const invoiceId = await createIssuedInvoice(
        accessToken,
        organizationId,
        contactId,
        300,
      );

      await request(server)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ invoiceId, amount: 200 })
        .expect(201);

      const secondRes = await request(server)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ invoiceId, amount: 200 })
        .expect(400);
      expect(asError(secondRes.body).code).toBe('PAYMENT_EXCEEDS_BALANCE');

      const res = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const invoice = asSuccess<InvoicePayload>(res.body);
      expect(invoice.amountPaid).toBe(200);
      expect(invoice.status).toBe('partially_paid');
    });
  });

  describe('Payment/Invoice MongoDB transaction integrity', () => {
    async function createIssuedInvoice(
      accessToken: string,
      organizationId: string,
      contactId: string,
      total: number,
    ): Promise<string> {
      const invoiceRes = await request(server)
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          currency: 'EUR',
          items: [{ description: 'Service', quantity: 1, unitPrice: total }],
        })
        .expect(201);
      const invoiceId = asSuccess<InvoicePayload>(invoiceRes.body).id;

      await request(server)
        .post(`/api/v1/invoices/${invoiceId}/issue`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      return invoiceId;
    }

    it('commits Invoice.amountPaid and the Payment document together for a successful payment', async () => {
      const { accessToken, organizationId, contactId } =
        await registerOrgAndContact(
          'tx-success-owner@korva.test',
          'Tx Success Org',
        );
      const invoiceId = await createIssuedInvoice(
        accessToken,
        organizationId,
        contactId,
        300,
      );

      const paymentRes = await request(server)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ invoiceId, amount: 300, method: 'cash' })
        .expect(201);
      const payment = asSuccess<PaymentPayload & { amount: number }>(
        paymentRes.body,
      );
      expect(payment.status).toBe('completed');
      expect(payment.amount).toBe(300);

      const invoiceRes = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const invoice = asSuccess<InvoicePayload>(invoiceRes.body);
      expect(invoice.amountPaid).toBe(300);
      expect(invoice.status).toBe('paid');
    });

    it('aborts the whole transaction when Payment creation fails after the Invoice update was staged — amountPaid stays unchanged and no Payment is created', async () => {
      const { accessToken, organizationId, contactId } =
        await registerOrgAndContact(
          'tx-rollback-owner@korva.test',
          'Tx Rollback Org',
        );
      const invoiceId = await createIssuedInvoice(
        accessToken,
        organizationId,
        contactId,
        300,
      );

      // Real MongoDB transaction, real HTTP layer, real invoice balance guard — the only thing
      // faked is a failure injected at the "create Payment" step, i.e. AFTER
      // incrementAmountPaidWithinLimit has staged the Invoice write inside the same
      // transaction but BEFORE commit. This is exactly the "erreur volontaire entre l'update
      // Invoice et le commit" scenario the audit asked to prove.
      const paymentsRepository = app.get(PaymentsRepository);
      const spy = jest
        .spyOn(paymentsRepository, 'createPayment')
        .mockImplementationOnce(() => {
          throw new Error('deliberate failure to prove transaction rollback');
        });

      try {
        const res = await request(server)
          .post('/api/v1/payments')
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .send({ invoiceId, amount: 100, method: 'cash' });
        expect(res.status).toBe(500);
        expect(asError(res.body).code).toBe('INTERNAL_SERVER_ERROR');
      } finally {
        spy.mockRestore();
      }

      const invoiceRes = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const invoice = asSuccess<InvoicePayload>(invoiceRes.body);
      // The staged amountPaid increment must have been rolled back with the rest of the
      // transaction — not left at some partially-applied value.
      expect(invoice.amountPaid).toBe(0);
      expect(invoice.status).toBe('issued');

      const paymentsRes = await request(server)
        .get(`/api/v1/payments?invoiceId=${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const payments = asSuccess<PaymentPayload[]>(paymentsRes.body);
      expect(payments).toHaveLength(0);

      // And the transaction being retried cleanly afterwards proves the invoice wasn't left in
      // some corrupted intermediate state by the aborted attempt.
      await request(server)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ invoiceId, amount: 100, method: 'cash' })
        .expect(201);

      const finalInvoiceRes = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<InvoicePayload>(finalInvoiceRes.body).amountPaid).toBe(
        100,
      );
    });
  });

  describe('Idempotency-Key protects PaymentsService.create() against retries and concurrency', () => {
    async function createIssuedInvoice(
      accessToken: string,
      organizationId: string,
      contactId: string,
      total: number,
    ): Promise<string> {
      const invoiceRes = await request(server)
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          currency: 'EUR',
          items: [{ description: 'Service', quantity: 1, unitPrice: total }],
        })
        .expect(201);
      const invoiceId = asSuccess<InvoicePayload>(invoiceRes.body).id;

      await request(server)
        .post(`/api/v1/invoices/${invoiceId}/issue`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      return invoiceId;
    }

    function pay(
      accessToken: string,
      organizationId: string,
      invoiceId: string,
      amount: number,
      idempotencyKey?: string,
    ) {
      const req = request(server)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId);
      if (idempotencyKey) req.set('Idempotency-Key', idempotencyKey);
      return req.send({ invoiceId, amount, method: 'cash' });
    }

    it('TEST 1 — same key, two sequential requests: single provider call, same Payment returned both times', async () => {
      const { accessToken, organizationId, contactId } =
        await registerOrgAndContact(
          'idem-sequential-owner@korva.test',
          'Idem Sequential Org',
        );
      const invoiceId = await createIssuedInvoice(
        accessToken,
        organizationId,
        contactId,
        300,
      );

      const paymentProvider = app.get<PaymentProvider>(PAYMENT_PROVIDER);
      const spy = jest.spyOn(paymentProvider, 'createPayment');
      const callsBefore = spy.mock.calls.length;

      const firstRes = await pay(
        accessToken,
        organizationId,
        invoiceId,
        100,
        'idem-key-sequential-1',
      ).expect(201);
      const secondRes = await pay(
        accessToken,
        organizationId,
        invoiceId,
        100,
        'idem-key-sequential-1',
      ).expect(201);

      const first = asSuccess<PaymentPayload>(firstRes.body);
      const second = asSuccess<PaymentPayload>(secondRes.body);
      expect(second.id).toBe(first.id);
      expect(second.status).toBe('completed');
      expect(spy.mock.calls.length - callsBefore).toBe(1);

      const invoiceRes = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      // Credited once (100), not twice (200) — the retry must not re-credit the invoice.
      expect(asSuccess<InvoicePayload>(invoiceRes.body).amountPaid).toBe(100);

      const paymentsRes = await request(server)
        .get(`/api/v1/payments?invoiceId=${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<PaymentPayload[]>(paymentsRes.body)).toHaveLength(1);

      spy.mockRestore();
    });

    it('TEST 2 — same key, two genuinely concurrent requests: single provider call, single Payment, single Invoice credit', async () => {
      const { accessToken, organizationId, contactId } =
        await registerOrgAndContact(
          'idem-concurrent-owner@korva.test',
          'Idem Concurrent Org',
        );
      const invoiceId = await createIssuedInvoice(
        accessToken,
        organizationId,
        contactId,
        300,
      );

      const paymentProvider = app.get<PaymentProvider>(PAYMENT_PROVIDER);
      const spy = jest.spyOn(paymentProvider, 'createPayment');
      const callsBefore = spy.mock.calls.length;

      // Dispatched before either is awaited — a genuine race on the same Idempotency-Key, not
      // two sequential calls. The atomic unique index on (organizationId, idempotencyKey) is
      // what guarantees only one of the two claim-inserts can win; the loser must never call
      // the provider at all.
      const [resA, resB] = await Promise.all([
        pay(
          accessToken,
          organizationId,
          invoiceId,
          150,
          'idem-key-concurrent-1',
        ),
        pay(
          accessToken,
          organizationId,
          invoiceId,
          150,
          'idem-key-concurrent-1',
        ),
      ]);

      expect(resA.status).toBe(201);
      expect(resB.status).toBe(201);
      const a = asSuccess<PaymentPayload>(resA.body);
      const b = asSuccess<PaymentPayload>(resB.body);
      expect(b.id).toBe(a.id);
      expect(spy.mock.calls.length - callsBefore).toBe(1);

      const paymentsRes = await request(server)
        .get(`/api/v1/payments?invoiceId=${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const payments = asSuccess<PaymentPayload[]>(paymentsRes.body);
      expect(payments).toHaveLength(1);
      expect(payments[0]!.status).toBe('completed');

      const invoiceRes = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      // Credited exactly once (150), never twice (300) — proves MongoDB's unique index, not a
      // racy in-memory check, is what arbitrated the two concurrent claims.
      expect(asSuccess<InvoicePayload>(invoiceRes.body).amountPaid).toBe(150);

      spy.mockRestore();
    });

    it('TEST 3 — same key with different parameters is refused, without a second provider call', async () => {
      const { accessToken, organizationId, contactId } =
        await registerOrgAndContact(
          'idem-mismatch-owner@korva.test',
          'Idem Mismatch Org',
        );
      const invoiceId = await createIssuedInvoice(
        accessToken,
        organizationId,
        contactId,
        300,
      );

      const paymentProvider = app.get<PaymentProvider>(PAYMENT_PROVIDER);
      const spy = jest.spyOn(paymentProvider, 'createPayment');
      const callsBefore = spy.mock.calls.length;

      await pay(
        accessToken,
        organizationId,
        invoiceId,
        100,
        'idem-key-mismatch-1',
      ).expect(201);

      const mismatchRes = await pay(
        accessToken,
        organizationId,
        invoiceId,
        200, // different amount, same key
        'idem-key-mismatch-1',
      );
      expect(mismatchRes.status).toBe(400);
      expect(asError(mismatchRes.body).code).toBe('IDEMPOTENCY_KEY_MISMATCH');

      // Only the first (accepted) call reached the provider — the mismatched retry must be
      // rejected before ever calling it again.
      expect(spy.mock.calls.length - callsBefore).toBe(1);

      const paymentsRes = await request(server)
        .get(`/api/v1/payments?invoiceId=${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<PaymentPayload[]>(paymentsRes.body)).toHaveLength(1);

      spy.mockRestore();
    });

    it('TEST 4 — retrying after a completed payment never creates a second Payment or re-credits the Invoice', async () => {
      const { accessToken, organizationId, contactId } =
        await registerOrgAndContact(
          'idem-retry-owner@korva.test',
          'Idem Retry Org',
        );
      const invoiceId = await createIssuedInvoice(
        accessToken,
        organizationId,
        contactId,
        300,
      );

      const completedRes = await pay(
        accessToken,
        organizationId,
        invoiceId,
        300,
        'idem-key-retry-1',
      ).expect(201);
      const completed = asSuccess<PaymentPayload>(completedRes.body);
      expect(completed.status).toBe('completed');

      const paymentProvider = app.get<PaymentProvider>(PAYMENT_PROVIDER);
      const spy = jest.spyOn(paymentProvider, 'createPayment');
      const callsBefore = spy.mock.calls.length;

      const retryRes = await pay(
        accessToken,
        organizationId,
        invoiceId,
        300,
        'idem-key-retry-1',
      ).expect(201);
      expect(asSuccess<PaymentPayload>(retryRes.body).id).toBe(completed.id);
      expect(spy.mock.calls.length - callsBefore).toBe(0);

      const invoiceRes = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const invoice = asSuccess<InvoicePayload>(invoiceRes.body);
      expect(invoice.amountPaid).toBe(300);
      expect(invoice.status).toBe('paid');

      spy.mockRestore();
    });

    it('TEST 5 — provider failure leaves a resolved, non-fantom Payment; retrying with the same key never calls the provider again or credits the Invoice', async () => {
      const { accessToken, organizationId, contactId } =
        await registerOrgAndContact(
          'idem-provider-failure-owner@korva.test',
          'Idem Provider Failure Org',
        );
      const invoiceId = await createIssuedInvoice(
        accessToken,
        organizationId,
        contactId,
        300,
      );

      const paymentProvider = app.get<PaymentProvider>(PAYMENT_PROVIDER);
      const spy = jest
        .spyOn(paymentProvider, 'createPayment')
        .mockRejectedValueOnce(new Error('simulated provider outage'));

      const failedRes = await pay(
        accessToken,
        organizationId,
        invoiceId,
        100,
        'idem-key-provider-failure-1',
      );
      expect(failedRes.status).toBe(500);

      const paymentsAfterFailureRes = await request(server)
        .get(`/api/v1/payments?invoiceId=${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const paymentsAfterFailure = asSuccess<PaymentPayload[]>(
        paymentsAfterFailureRes.body,
      );
      // The claim must resolve to a terminal 'failed' state — never left stuck 'processing'.
      expect(paymentsAfterFailure).toHaveLength(1);
      expect(paymentsAfterFailure[0]!.status).toBe('failed');

      const invoiceAfterFailureRes = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(
        asSuccess<InvoicePayload>(invoiceAfterFailureRes.body).amountPaid,
      ).toBe(0);

      // Retry with the SAME key — by design, a key is permanently bound to its first resolved
      // outcome (even a failure); the provider must not be called a second time for it. A
      // genuinely new attempt requires a new Idempotency-Key, which is a separate, deliberately
      // simple contract documented in PaymentsService.create.
      const callsBeforeRetry = spy.mock.calls.length;
      const retryRes = await pay(
        accessToken,
        organizationId,
        invoiceId,
        100,
        'idem-key-provider-failure-1',
      ).expect(201);
      expect(asSuccess<PaymentPayload>(retryRes.body).status).toBe('failed');
      expect(spy.mock.calls.length - callsBeforeRetry).toBe(0);

      const invoiceAfterRetryRes = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(
        asSuccess<InvoicePayload>(invoiceAfterRetryRes.body).amountPaid,
      ).toBe(0);

      spy.mockRestore();
    });

    it('TEST 6 — legacy callers without an Idempotency-Key keep working exactly as before', async () => {
      const { accessToken, organizationId, contactId } =
        await registerOrgAndContact(
          'idem-legacy-owner@korva.test',
          'Idem Legacy Org',
        );
      const invoiceId = await createIssuedInvoice(
        accessToken,
        organizationId,
        contactId,
        300,
      );

      // No Idempotency-Key header at all — two independent payments, both must succeed and
      // both must be recorded, exactly like before this feature existed.
      await pay(accessToken, organizationId, invoiceId, 100).expect(201);
      await pay(accessToken, organizationId, invoiceId, 100).expect(201);

      const paymentsRes = await request(server)
        .get(`/api/v1/payments?invoiceId=${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<PaymentPayload[]>(paymentsRes.body)).toHaveLength(2);

      const invoiceRes = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<InvoicePayload>(invoiceRes.body).amountPaid).toBe(200);
    });
  });

  describe('Refund/Payment/Invoice MongoDB transaction integrity', () => {
    async function createFullyPaidInvoiceAndPayment(
      accessToken: string,
      organizationId: string,
      contactId: string,
      total: number,
    ): Promise<{ invoiceId: string; paymentId: string }> {
      const invoiceRes = await request(server)
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          currency: 'EUR',
          items: [{ description: 'Service', quantity: 1, unitPrice: total }],
        })
        .expect(201);
      const invoiceId = asSuccess<InvoicePayload>(invoiceRes.body).id;

      await request(server)
        .post(`/api/v1/invoices/${invoiceId}/issue`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      const paymentRes = await request(server)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ invoiceId, amount: total, method: 'cash' })
        .expect(201);
      const paymentId = asSuccess<PaymentPayload>(paymentRes.body).id;

      return { invoiceId, paymentId };
    }

    it('two concurrent 200 refunds on a 300 payment: exactly one succeeds, the other gets REFUND_EXCEEDS_PAYMENT, refundedAmount never exceeds 300', async () => {
      const { accessToken, organizationId, contactId } =
        await registerOrgAndContact(
          'refund-race-owner@korva.test',
          'Refund Race Org',
        );
      const { invoiceId, paymentId } = await createFullyPaidInvoiceAndPayment(
        accessToken,
        organizationId,
        contactId,
        300,
      );

      // Dispatched before either is awaited — a genuine race against the same Payment, not two
      // sequential calls. Before this fix, both could read alreadyRefunded=0 via the same
      // stale sumRefundsForPayment() snapshot and both succeed, landing on 400 refunded out of
      // a 300 payment (per the scenario in the audit).
      const [resA, resB] = await Promise.all([
        request(server)
          .post('/api/v1/payments/refunds')
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .set('Idempotency-Key', 'refund-race-a')
          .send({ paymentId, amount: 200 }),
        request(server)
          .post('/api/v1/payments/refunds')
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .set('Idempotency-Key', 'refund-race-b')
          .send({ paymentId, amount: 200 }),
      ]);

      const results = [resA, resB];
      const succeeded = results.filter((r) => r.status === 201);
      const rejected = results.filter((r) => r.status === 400);
      expect(succeeded).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(asError(rejected[0]!.body).code).toBe('REFUND_EXCEEDS_PAYMENT');

      const paymentsRes = await request(server)
        .get(`/api/v1/payments?invoiceId=${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const payments = asSuccess<
        (PaymentPayload & { refundedAmount: number })[]
      >(paymentsRes.body);
      expect(payments).toHaveLength(1);
      // 200 of 300 refunded — not fully refunded, so the payment stays 'completed', never a
      // second, unguarded refund landing on top of it.
      expect(payments[0]!.refundedAmount).toBe(200);
      expect(payments[0]!.status).toBe('completed');

      // Invoice.amountPaid must have been decremented exactly once (by the single winning
      // refund), not zero times and not twice.
      const invoiceRes = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const invoice = asSuccess<InvoicePayload>(invoiceRes.body);
      expect(invoice.amountPaid).toBe(100); // 300 - 200, never 300 - 400
      expect(invoice.status).toBe('partially_paid');
    });

    it('successive valid refunds: 100 then 200 on a 300 payment reach refundedAmount=300, status=refunded, Invoice.amountPaid=0', async () => {
      const { accessToken, organizationId, contactId } =
        await registerOrgAndContact(
          'refund-successive-owner@korva.test',
          'Refund Successive Org',
        );
      const { invoiceId, paymentId } = await createFullyPaidInvoiceAndPayment(
        accessToken,
        organizationId,
        contactId,
        300,
      );

      await request(server)
        .post('/api/v1/payments/refunds')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .set('Idempotency-Key', 'refund-successive-1')
        .send({ paymentId, amount: 100 })
        .expect(201);

      await request(server)
        .post('/api/v1/payments/refunds')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .set('Idempotency-Key', 'refund-successive-2')
        .send({ paymentId, amount: 200 })
        .expect(201);

      const paymentsRes = await request(server)
        .get(`/api/v1/payments?invoiceId=${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const payments = asSuccess<
        (PaymentPayload & { refundedAmount: number })[]
      >(paymentsRes.body);
      expect(payments[0]!.refundedAmount).toBe(300);
      expect(payments[0]!.status).toBe('refunded');

      const invoiceRes = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const invoice = asSuccess<InvoicePayload>(invoiceRes.body);
      expect(invoice.amountPaid).toBe(0);
      expect(invoice.status).toBe('issued');
    });

    it('sequential overpayment: 200 then 200 refunded on a 300 payment — first accepted, second rejected, refundedAmount=200', async () => {
      const { accessToken, organizationId, contactId } =
        await registerOrgAndContact(
          'refund-sequential-owner@korva.test',
          'Refund Sequential Org',
        );
      const { paymentId } = await createFullyPaidInvoiceAndPayment(
        accessToken,
        organizationId,
        contactId,
        300,
      );

      await request(server)
        .post('/api/v1/payments/refunds')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .set('Idempotency-Key', 'refund-sequential-overpay-1')
        .send({ paymentId, amount: 200 })
        .expect(201);

      const secondRes = await request(server)
        .post('/api/v1/payments/refunds')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .set('Idempotency-Key', 'refund-sequential-overpay-2')
        .send({ paymentId, amount: 200 })
        .expect(400);
      expect(asError(secondRes.body).code).toBe('REFUND_EXCEEDS_PAYMENT');
    });

    it('a failure while claiming the Idempotency-Key prevents any refund from being attempted at all — no provider call, no Payment/Invoice mutation, and a retry with a fresh key succeeds normally', async () => {
      const { accessToken, organizationId, contactId } =
        await registerOrgAndContact(
          'refund-rollback-owner@korva.test',
          'Refund Rollback Org',
        );
      const { invoiceId, paymentId } = await createFullyPaidInvoiceAndPayment(
        accessToken,
        organizationId,
        contactId,
        300,
      );

      // Stage 2.7B note: this test used to inject the failure inside the atomic transaction
      // (createRefund called from refundAtomically's no-claim branch). Idempotency-Key is now
      // mandatory for refunds, so PaymentsService.refund() always claims one via createRefund
      // BEFORE ever entering a transaction or calling the provider (see refund()'s own claim
      // step) — that no-claim branch inside refundAtomically is consequently unreachable from
      // either of its callers (this method and reconcileProcessingRefund, which always passes
      // an existing Refund id too). refundAtomically itself is unchanged (out of this stage's
      // scope); this test now proves the equally important, earlier failure point instead: a
      // failure while claiming the key must still leave zero trace and never block a genuine
      // retry (with a new key).
      const paymentsRepository = app.get(PaymentsRepository);
      const spy = jest
        .spyOn(paymentsRepository, 'createRefund')
        .mockImplementationOnce(() => {
          throw new Error(
            'deliberate failure to prove refund transaction rollback',
          );
        });

      try {
        const res = await request(server)
          .post('/api/v1/payments/refunds')
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .set('Idempotency-Key', 'refund-rollback-trigger')
          .send({ paymentId, amount: 100 });
        expect(res.status).toBe(500);
        expect(asError(res.body).code).toBe('INTERNAL_SERVER_ERROR');
      } finally {
        spy.mockRestore();
      }

      const paymentsRes = await request(server)
        .get(`/api/v1/payments?invoiceId=${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const payments = asSuccess<
        (PaymentPayload & { refundedAmount: number })[]
      >(paymentsRes.body);
      // The staged refundedAmount increment must have been rolled back with the rest of the
      // transaction — not left at some partially-applied value.
      expect(payments[0]!.refundedAmount).toBe(0);
      expect(payments[0]!.status).toBe('completed');

      const invoiceRes = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const invoice = asSuccess<InvoicePayload>(invoiceRes.body);
      expect(invoice.amountPaid).toBe(300);
      expect(invoice.status).toBe('paid');

      // And a valid refund attempted right after proves the payment/invoice weren't left in
      // some corrupted intermediate state by the aborted attempt.
      await request(server)
        .post('/api/v1/payments/refunds')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .set('Idempotency-Key', 'refund-rollback-retry')
        .send({ paymentId, amount: 100 })
        .expect(201);

      const finalInvoiceRes = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<InvoicePayload>(finalInvoiceRes.body).amountPaid).toBe(
        200,
      );
    });
  });

  describe('Idempotency-Key protects PaymentsService.refund() against retries and concurrency', () => {
    async function createFullyPaidInvoiceAndPayment(
      accessToken: string,
      organizationId: string,
      contactId: string,
      total: number,
    ): Promise<{ invoiceId: string; paymentId: string }> {
      const invoiceRes = await request(server)
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          currency: 'EUR',
          items: [{ description: 'Service', quantity: 1, unitPrice: total }],
        })
        .expect(201);
      const invoiceId = asSuccess<InvoicePayload>(invoiceRes.body).id;

      await request(server)
        .post(`/api/v1/invoices/${invoiceId}/issue`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      const paymentRes = await request(server)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ invoiceId, amount: total, method: 'cash' })
        .expect(201);
      const paymentId = asSuccess<PaymentPayload>(paymentRes.body).id;

      return { invoiceId, paymentId };
    }

    function refundReq(
      accessToken: string,
      organizationId: string,
      paymentId: string,
      amount: number,
      idempotencyKey?: string,
    ) {
      const req = request(server)
        .post('/api/v1/payments/refunds')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId);
      if (idempotencyKey) req.set('Idempotency-Key', idempotencyKey);
      return req.send({ paymentId, amount, reason: 'goodwill' });
    }

    it('TEST 1 — same key, two sequential requests: single provider call, same Refund returned both times', async () => {
      const { accessToken, organizationId, contactId } =
        await registerOrgAndContact(
          'refund-idem-sequential-owner@korva.test',
          'Refund Idem Sequential Org',
        );
      const { invoiceId, paymentId } = await createFullyPaidInvoiceAndPayment(
        accessToken,
        organizationId,
        contactId,
        300,
      );

      const paymentProvider = app.get<PaymentProvider>(PAYMENT_PROVIDER);
      const spy = jest.spyOn(paymentProvider, 'refundPayment');
      const callsBefore = spy.mock.calls.length;

      const firstRes = await refundReq(
        accessToken,
        organizationId,
        paymentId,
        100,
        'refund-idem-key-sequential-1',
      ).expect(201);
      const secondRes = await refundReq(
        accessToken,
        organizationId,
        paymentId,
        100,
        'refund-idem-key-sequential-1',
      ).expect(201);

      const first = asSuccess<{ id: string; amount: number }>(firstRes.body);
      const second = asSuccess<{ id: string; amount: number }>(secondRes.body);
      expect(second.id).toBe(first.id);
      expect(spy.mock.calls.length - callsBefore).toBe(1);

      const paymentRes = await request(server)
        .get(`/api/v1/payments?invoiceId=${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const payment = asSuccess<
        (PaymentPayload & { refundedAmount: number })[]
      >(paymentRes.body)[0]!;
      // Decremented once (100), not twice (200) — the retry must not double-refund.
      expect(payment.refundedAmount).toBe(100);

      const invoiceRes = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<InvoicePayload>(invoiceRes.body).amountPaid).toBe(200);

      spy.mockRestore();
    });

    it('TEST 2 — same key, two genuinely concurrent requests: single provider call, single Refund, single Payment/Invoice adjustment', async () => {
      const { accessToken, organizationId, contactId } =
        await registerOrgAndContact(
          'refund-idem-concurrent-owner@korva.test',
          'Refund Idem Concurrent Org',
        );
      const { invoiceId, paymentId } = await createFullyPaidInvoiceAndPayment(
        accessToken,
        organizationId,
        contactId,
        300,
      );

      const paymentProvider = app.get<PaymentProvider>(PAYMENT_PROVIDER);
      const spy = jest.spyOn(paymentProvider, 'refundPayment');
      const callsBefore = spy.mock.calls.length;

      // Dispatched before either is awaited — a genuine race on the same Idempotency-Key. The
      // atomic unique index on (organizationId, idempotencyKey) on Refund is what guarantees
      // only one claim-insert can win; the loser must never call the provider, and must never
      // trip REFUND_EXCEEDS_PAYMENT artificially.
      const [resA, resB] = await Promise.all([
        refundReq(
          accessToken,
          organizationId,
          paymentId,
          150,
          'refund-idem-key-concurrent-1',
        ),
        refundReq(
          accessToken,
          organizationId,
          paymentId,
          150,
          'refund-idem-key-concurrent-1',
        ),
      ]);

      expect(resA.status).toBe(201);
      expect(resB.status).toBe(201);
      const a = asSuccess<{ id: string }>(resA.body);
      const b = asSuccess<{ id: string }>(resB.body);
      expect(b.id).toBe(a.id);
      expect(spy.mock.calls.length - callsBefore).toBe(1);

      const paymentRes = await request(server)
        .get(`/api/v1/payments?invoiceId=${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const payment = asSuccess<
        (PaymentPayload & { refundedAmount: number })[]
      >(paymentRes.body)[0]!;
      // Decremented exactly once (150), never twice (300) — proves MongoDB's unique index,
      // not a racy in-memory check, arbitrated the two concurrent claims.
      expect(payment.refundedAmount).toBe(150);

      const invoiceRes = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<InvoicePayload>(invoiceRes.body).amountPaid).toBe(150);

      spy.mockRestore();
    });

    it('TEST 3 — same key with a different amount is refused, without a second provider call', async () => {
      const { accessToken, organizationId, contactId } =
        await registerOrgAndContact(
          'refund-idem-mismatch-owner@korva.test',
          'Refund Idem Mismatch Org',
        );
      const { paymentId } = await createFullyPaidInvoiceAndPayment(
        accessToken,
        organizationId,
        contactId,
        300,
      );

      const paymentProvider = app.get<PaymentProvider>(PAYMENT_PROVIDER);
      const spy = jest.spyOn(paymentProvider, 'refundPayment');
      const callsBefore = spy.mock.calls.length;

      await refundReq(
        accessToken,
        organizationId,
        paymentId,
        100,
        'refund-idem-key-mismatch-1',
      ).expect(201);

      const mismatchRes = await refundReq(
        accessToken,
        organizationId,
        paymentId,
        200, // different amount, same key
        'refund-idem-key-mismatch-1',
      );
      expect(mismatchRes.status).toBe(400);
      expect(asError(mismatchRes.body).code).toBe('IDEMPOTENCY_KEY_MISMATCH');
      expect(spy.mock.calls.length - callsBefore).toBe(1);

      spy.mockRestore();
    });

    it('TEST 4 — retrying after a completed refund never creates a second Refund or double-adjusts Payment/Invoice', async () => {
      const { accessToken, organizationId, contactId } =
        await registerOrgAndContact(
          'refund-idem-retry-owner@korva.test',
          'Refund Idem Retry Org',
        );
      const { invoiceId, paymentId } = await createFullyPaidInvoiceAndPayment(
        accessToken,
        organizationId,
        contactId,
        300,
      );

      const completedRes = await refundReq(
        accessToken,
        organizationId,
        paymentId,
        300,
        'refund-idem-key-retry-1',
      ).expect(201);
      const completed = asSuccess<{ id: string }>(completedRes.body);

      const paymentProvider = app.get<PaymentProvider>(PAYMENT_PROVIDER);
      const spy = jest.spyOn(paymentProvider, 'refundPayment');
      const callsBefore = spy.mock.calls.length;

      const retryRes = await refundReq(
        accessToken,
        organizationId,
        paymentId,
        300,
        'refund-idem-key-retry-1',
      ).expect(201);
      expect(asSuccess<{ id: string }>(retryRes.body).id).toBe(completed.id);
      expect(spy.mock.calls.length - callsBefore).toBe(0);

      const paymentRes = await request(server)
        .get(`/api/v1/payments?invoiceId=${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const payment = asSuccess<
        (PaymentPayload & { refundedAmount: number })[]
      >(paymentRes.body)[0]!;
      expect(payment.refundedAmount).toBe(300);
      expect(payment.status).toBe('refunded');

      const invoiceRes = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<InvoicePayload>(invoiceRes.body).amountPaid).toBe(0);

      spy.mockRestore();
    });

    it('TEST 5 — provider failure leaves no successful Refund; Payment/Invoice stay unchanged; retrying with the same key never calls the provider again', async () => {
      const { accessToken, organizationId, contactId } =
        await registerOrgAndContact(
          'refund-idem-provider-failure-owner@korva.test',
          'Refund Idem Provider Failure Org',
        );
      const { invoiceId, paymentId } = await createFullyPaidInvoiceAndPayment(
        accessToken,
        organizationId,
        contactId,
        300,
      );

      const paymentProvider = app.get<PaymentProvider>(PAYMENT_PROVIDER);
      const spy = jest
        .spyOn(paymentProvider, 'refundPayment')
        .mockRejectedValueOnce(new Error('simulated provider outage'));

      const failedRes = await refundReq(
        accessToken,
        organizationId,
        paymentId,
        100,
        'refund-idem-key-provider-failure-1',
      );
      expect(failedRes.status).toBe(500);

      const paymentAfterFailureRes = await request(server)
        .get(`/api/v1/payments?invoiceId=${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const paymentAfterFailure = asSuccess<
        (PaymentPayload & { refundedAmount: number })[]
      >(paymentAfterFailureRes.body)[0]!;
      // No "successful" Refund was created — the failed claim is not visible as a real refund,
      // and refundedAmount is untouched (the transaction never ran).
      expect(paymentAfterFailure.refundedAmount).toBe(0);
      expect(paymentAfterFailure.status).toBe('completed');

      const invoiceAfterFailureRes = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(
        asSuccess<InvoicePayload>(invoiceAfterFailureRes.body).amountPaid,
      ).toBe(300);

      // Retry with the SAME key — documented behavior: a key is permanently bound to its first
      // resolved outcome (even a failure), so the provider is never called a second time for
      // it. A genuinely new attempt requires a new Idempotency-Key.
      const callsBeforeRetry = spy.mock.calls.length;
      // The retry returns the resolved (failed) claim, not a fresh attempt — no `amount` field
      // guarantees success; what matters is no provider call and no Payment/Invoice mutation.
      await refundReq(
        accessToken,
        organizationId,
        paymentId,
        100,
        'refund-idem-key-provider-failure-1',
      ).expect(201);
      expect(spy.mock.calls.length - callsBeforeRetry).toBe(0);

      const invoiceAfterRetryRes = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(
        asSuccess<InvoicePayload>(invoiceAfterRetryRes.body).amountPaid,
      ).toBe(300);

      spy.mockRestore();
    });

    it('TEST 6 (Stage 2.7B) — a refund WITHOUT an Idempotency-Key is now rejected outright: REFUND_IDEMPOTENCY_KEY_REQUIRED, no provider call, no Refund claim, no mutation of any kind', async () => {
      const { accessToken, organizationId, contactId } =
        await registerOrgAndContact(
          'refund-idem-legacy-owner@korva.test',
          'Refund Idem Legacy Org',
        );
      const { invoiceId, paymentId } = await createFullyPaidInvoiceAndPayment(
        accessToken,
        organizationId,
        contactId,
        300,
      );

      const paymentProvider = app.get<PaymentProvider>(PAYMENT_PROVIDER);
      const spy = jest.spyOn(paymentProvider, 'refundPayment');

      // No Idempotency-Key header at all — Stage 2.7B made this mandatory for refunds
      // specifically (never for POST /payments — see TEST 6 in the payment idempotency
      // describe block above, unchanged).
      const res = await refundReq(
        accessToken,
        organizationId,
        paymentId,
        100,
      ).expect(400);
      expect(asError(res.body).code).toBe('REFUND_IDEMPOTENCY_KEY_REQUIRED');
      expect(spy).not.toHaveBeenCalled();

      const paymentRes = await request(server)
        .get(`/api/v1/payments?invoiceId=${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const payment = asSuccess<
        (PaymentPayload & { refundedAmount: number })[]
      >(paymentRes.body)[0]!;
      expect(payment.refundedAmount).toBe(0);

      const invoiceRes = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<InvoicePayload>(invoiceRes.body).amountPaid).toBe(300);

      spy.mockRestore();
    });

    it('TEST 7 — aborts the whole idempotent transaction when finalizing the Refund fails after the Payment increment was staged — no successful Refund persists, Payment/Invoice stay unchanged, and a retry succeeds normally', async () => {
      const { accessToken, organizationId, contactId } =
        await registerOrgAndContact(
          'refund-idem-rollback-owner@korva.test',
          'Refund Idem Rollback Org',
        );
      const { invoiceId, paymentId } = await createFullyPaidInvoiceAndPayment(
        accessToken,
        organizationId,
        contactId,
        300,
      );

      // Real MongoDB transaction, real HTTP layer, real atomic refund guard — the only thing
      // faked is a failure injected at the transactional "finalize claimed Refund to
      // completed" step specifically (matched by `status: 'completed'` in the write), i.e.
      // AFTER incrementRefundedAmountWithinLimit staged the Payment write inside the
      // transaction but BEFORE commit. finalizeRefund is also called once earlier, outside any
      // transaction, to persist the provider reference (persistRefundProviderReference) — that
      // call must succeed normally, so the mock only targets the completion write, not just
      // "the next call".
      const paymentsRepository = app.get(PaymentsRepository);
      const realFinalizeRefund =
        paymentsRepository.finalizeRefund.bind(paymentsRepository);
      const spy = jest
        .spyOn(paymentsRepository, 'finalizeRefund')
        .mockImplementation(
          (...args: Parameters<typeof realFinalizeRefund>) => {
            if (args[2]?.status === 'completed') {
              throw new Error(
                'deliberate failure to prove idempotent refund transaction rollback',
              );
            }
            return realFinalizeRefund(...args);
          },
        );

      try {
        const res = await refundReq(
          accessToken,
          organizationId,
          paymentId,
          100,
          'refund-idem-key-rollback-1',
        );
        expect(res.status).toBe(500);
        expect(asError(res.body).code).toBe('INTERNAL_SERVER_ERROR');
      } finally {
        spy.mockRestore();
      }

      const paymentAfterAbortRes = await request(server)
        .get(`/api/v1/payments?invoiceId=${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const paymentAfterAbort = asSuccess<
        (PaymentPayload & { refundedAmount: number })[]
      >(paymentAfterAbortRes.body)[0]!;
      // The staged refundedAmount increment must have been rolled back with the rest of the
      // transaction — not left at some partially-applied value.
      expect(paymentAfterAbort.refundedAmount).toBe(0);
      expect(paymentAfterAbort.status).toBe('completed');

      const invoiceAfterAbortRes = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(
        asSuccess<InvoicePayload>(invoiceAfterAbortRes.body).amountPaid,
      ).toBe(300);

      // A retry right after — same key, since the claim itself resolved to 'failed' via the
      // outer catch block's cleanup — proves the payment wasn't left in a corrupted state.
      // Because the previous attempt's claim is now terminally 'failed', this retry is treated
      // as returning that same resolved (failed) outcome, not a fresh charge — consistent with
      // TEST 5's documented "one key, one permanent outcome" behavior. A genuinely fresh retry
      // uses a NEW key instead, which must succeed normally.
      await refundReq(
        accessToken,
        organizationId,
        paymentId,
        100,
        'refund-idem-key-rollback-2',
      ).expect(201);

      const finalPaymentRes = await request(server)
        .get(`/api/v1/payments?invoiceId=${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const finalPayment = asSuccess<
        (PaymentPayload & { refundedAmount: number })[]
      >(finalPaymentRes.body)[0]!;
      expect(finalPayment.refundedAmount).toBe(100);

      const finalInvoiceRes = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<InvoicePayload>(finalInvoiceRes.body).amountPaid).toBe(
        200,
      );
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

// Expenses module, Quote expiry scheduler, and Invoice overdue scheduler tests were moved to
// their own e2e spec files (expenses.e2e-spec.ts, quote-expiry-scheduler.e2e-spec.ts,
// invoice-overdue-scheduler.e2e-spec.ts) — this file alone had grown past AUTH_THROTTLE's 30
// registrations/60s budget, and each e2e spec file boots its own app with its own throttle
// storage (see the identical rationale already documented in catalog.e2e-spec.ts /
// payment-reconciliation.e2e-spec.ts). No behavior change, pure relocation.
