import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { putOrganizationOnPlan } from './support/plan-tier';

/**
 * Donations and pay-what-you-want offers (Offer.freeAmount): the one storefront line whose amount
 * the customer names. Everything here is about that hole staying exactly as wide as intended —
 * the minimum holds, and a fixed-price offer still never takes a client-sent amount. Standalone
 * file, one registration, to stay clear of other files' AUTH_THROTTLE budget.
 */

interface ApiSuccess<T> {
  success: true;
  data: T;
}
interface ApiError {
  success: false;
  error: { code: string; message: string };
}
function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

describe('Storefront free amount (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  let slug: string;
  let auth: (req: request.Test) => request.Test;
  let donationId: string;
  let membershipId: string;

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

    const authRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email: 'asso-dons@korva.test', password: 'password123' })
      .expect(201);
    const accessToken = asSuccess<{ accessToken: string }>(
      authRes.body,
    ).accessToken;
    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Association Les Amis',
        type: 'association',
        country: 'CI',
        currency: 'XOF',
        timezone: 'Africa/Abidjan',
        language: 'fr',
      })
      .expect(201);
    const org = asSuccess<{ id: string; slug: string }>(orgRes.body);
    slug = org.slug;
    auth = (req) =>
      req
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', org.id);
    // Finance (recording the cash gift, for the receipt test) starts at Starter.
    await putOrganizationOnPlan(connection, org.id, 'starter');
    await auth(request(server).patch('/api/v1/organizations/me'))
      .send({
        enabledModules: ['catalog', 'commerce', 'crm', 'finance', 'website'],
      })
      .expect(200);

    const create = async (body: Record<string, unknown>) =>
      asSuccess<{ id: string }>(
        (
          await auth(request(server).post('/api/v1/offers'))
            .send({ status: 'active', ...body })
            .expect(201)
        ).body,
      ).id;
    donationId = await create({
      type: 'product',
      name: 'Don libre',
      freeAmount: true,
      pricing: { amount: 500, currency: 'XOF' },
    });
    membershipId = await create({
      type: 'product',
      name: 'Adhésion annuelle',
      pricing: { amount: 10000, currency: 'XOF' },
    });
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();
  });

  function placeOrder(items: Record<string, unknown>[]) {
    return request(server)
      .post(`/api/v1/public/${slug}/orders`)
      .send({
        currency: 'XOF',
        contact: { email: 'donateur@test.ci', firstName: 'Awa' },
        items,
      });
  }

  it('shows the storefront that the customer chooses the amount', async () => {
    const res = await request(server)
      .get(`/api/v1/public/${slug}/offers/${donationId}`)
      .expect(200);
    expect(asSuccess<{ freeAmount?: boolean }>(res.body).freeAmount).toBe(true);
  });

  it('charges the amount the donor chose, next to a fixed-price line', async () => {
    const res = await placeOrder([
      { offerId: donationId, quantity: 1, amount: 15000 },
      { offerId: membershipId, quantity: 1 },
    ]).expect(201);
    expect(asSuccess<{ total: number }>(res.body).total).toBe(25000);
  });

  it('keeps the minimum when the donor names no amount', async () => {
    const res = await placeOrder([{ offerId: donationId, quantity: 1 }]).expect(
      201,
    );
    expect(asSuccess<{ total: number }>(res.body).total).toBe(500);
  });

  it('refuses an amount below the minimum the association set', async () => {
    const res = await placeOrder([
      { offerId: donationId, quantity: 1, amount: 100 },
    ]).expect(400);
    expect(asError(res.body).code).toBe('AMOUNT_BELOW_MINIMUM');
  });

  it('never takes a client-sent amount on a fixed-price offer', async () => {
    const res = await placeOrder([
      { offerId: membershipId, quantity: 1, amount: 1 },
    ]).expect(400);
    expect(asError(res.body).code).toBe('AMOUNT_NOT_ALLOWED');
  });

  it('refuses a free amount on a booking, at creation and by a later edit', async () => {
    const created = await auth(request(server).post('/api/v1/offers'))
      .send({
        type: 'booking',
        name: 'Atelier',
        freeAmount: true,
        pricing: { amount: 5000, currency: 'XOF' },
      })
      .expect(400);
    expect(asError(created.body).code).toBe('FREE_AMOUNT_NOT_FOR_BOOKING');

    const edited = await auth(
      request(server).patch(`/api/v1/offers/${donationId}`),
    )
      .send({ type: 'booking' })
      .expect(400);
    expect(asError(edited.body).code).toBe('FREE_AMOUNT_NOT_FOR_BOOKING');
  });

  it('gives a donation receipt — non-fiscal — only once the gift is received', async () => {
    const placed = await placeOrder([
      { offerId: donationId, quantity: 1, amount: 20000 },
      { offerId: membershipId, quantity: 1 },
    ]).expect(201);
    const orderId = asSuccess<{ id: string }>(placed.body).id;
    const availability = () =>
      auth(
        request(server).get(
          `/api/v1/orders/${orderId}/donation-receipt/availability`,
        ),
      ).expect(200);

    expect(
      asSuccess<{ available: boolean }>((await availability()).body).available,
    ).toBe(false);
    const early = await auth(
      request(server).get(`/api/v1/orders/${orderId}/donation-receipt`),
    ).expect(400);
    expect(asError(early.body).code).toBe('DONATION_RECEIPT_NOT_AVAILABLE');

    await auth(
      request(server).post(`/api/v1/orders/${orderId}/confirm`),
    ).expect(201);
    const invoice = asSuccess<{ id: string; total: number }>(
      (
        await auth(
          request(server).post(`/api/v1/orders/${orderId}/generate-invoice`),
        ).expect(201)
      ).body,
    );
    await auth(
      request(server).post(`/api/v1/invoices/${invoice.id}/issue`),
    ).expect(201);
    await auth(request(server).post('/api/v1/payments'))
      .send({ invoiceId: invoice.id, amount: invoice.total, method: 'cash' })
      .expect(201);

    expect(
      asSuccess<{ available: boolean }>((await availability()).body).available,
    ).toBe(true);
    const pdf = await auth(
      request(server).get(`/api/v1/orders/${orderId}/donation-receipt`),
    )
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });
});
