import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { putOrganizationOnPlan } from './support/plan-tier';
import { IntegrationsService } from './../src/integrations/integrations.service';
import { IntegrationsRepository } from './../src/integrations/integrations.repository';

interface ApiSuccess<T> {
  success: true;
  data: T;
}
function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}

const WEBHOOK_SECRET = 'whsec_e2e';
const REFERENCE = 'MTX-E2E0000001';
const PLAN_REFERENCE = 'MTX-E2E0000002';

/**
 * A shop's customer pays an order by mobile money through GeniusPay, end to end: the storefront
 * gets GeniusPay's hosted checkout, GeniusPay's signed webhook arrives, and KORVA settles the
 * invoice after reading the status back from GeniusPay — never from the webhook body. GeniusPay
 * is a local stand-in serving the documented API (pay.genius.ci/doc).
 */
describe('GeniusPay mobile money (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  const gpStatus: Record<string, string> = {};
  let created = 0;
  const gpRequests: {
    method?: string;
    url?: string;
    headers: IncomingMessage['headers'];
    body: unknown;
  }[] = [];

  const stub: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    req.on('end', () => {
      gpRequests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: raw ? JSON.parse(raw) : undefined,
      });
      res.writeHead(req.method === 'POST' ? 201 : 200, {
        'Content-Type': 'application/json',
      });
      if (req.method === 'POST' && req.url === '/payments') {
        created += 1;
        const reference = created === 1 ? REFERENCE : PLAN_REFERENCE;
        gpStatus[reference] = 'pending';
        res.end(
          JSON.stringify({
            success: true,
            data: {
              id: created,
              reference,
              status: 'pending',
              checkout_url: `https://pay.genius.ci/checkout/${reference}`,
            },
          }),
        );
      } else if (req.method === 'GET' && req.url?.startsWith('/payments/')) {
        const reference = req.url.slice('/payments/'.length);
        res.end(
          JSON.stringify({
            success: true,
            data: { reference, status: gpStatus[reference] ?? 'pending' },
          }),
        );
      } else {
        res.end(JSON.stringify({ success: true, data: {} }));
      }
    });
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const { port } = stub.address() as AddressInfo;
    process.env.GENIUSPAY_API_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.GENIUSPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    // Imported only now: ConfigModule.forRoot() reads the environment when app.module loads.
    const { AppModule } = await import('./../src/app.module');
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
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
    // Booting the whole app took over 30 s on a loaded machine.
  }, 120_000);

  afterAll(async () => {
    delete process.env.GENIUSPAY_API_BASE_URL;
    delete process.env.GENIUSPAY_WEBHOOK_SECRET;
    await connection.dropDatabase();
    await app.close();
    await new Promise((resolve) => stub.close(resolve));
  });

  let slug: string;
  let orderId: string;
  let organizationId: string;
  let staffToken: string;

  it('sets up one GeniusPay account for every country, and an Ivorian shop that accepts online payment', async () => {
    const integrations = app.get(IntegrationsService);
    const account = await integrations.createPlatformAccount({
      domain: 'payment',
      provider: 'geniuspay',
      role: 'merchant-of-record',
      // One account for every country (no market) — KORVA's actual setup.
      market: null,
      secret: 'pk_sandbox_e2e sk_sandbox_e2e',
    });
    await app.get(IntegrationsRepository).updateStatus(account.id, 'active');

    const auth = await request(server)
      .post('/api/v1/auth/register')
      .send({ email: 'gp-owner@korva.test', password: 'password123' })
      .expect(201);
    const token = asSuccess<{ accessToken: string }>(auth.body).accessToken;
    const org = asSuccess<{ id: string; slug: string }>(
      (
        await request(server)
          .post('/api/v1/organizations')
          .set('Authorization', `Bearer ${token}`)
          .send({
            name: 'Boutique Awa',
            type: 'commerce',
            country: 'CI',
            currency: 'XOF',
            timezone: 'Africa/Abidjan',
            language: 'fr',
          })
          .expect(201)
      ).body,
    );
    slug = org.slug;
    organizationId = org.id;
    staffToken = token;
    await putOrganizationOnPlan(connection, org.id, 'starter');
    const staff = (req: request.Test) =>
      req
        .set('Authorization', `Bearer ${token}`)
        .set('X-Organization-Id', org.id);
    await staff(request(server).patch('/api/v1/organizations/me'))
      .send({
        enabledModules: ['crm', 'catalog', 'commerce', 'finance', 'website'],
        acceptedPaymentMethods: ['cash', 'online'],
      })
      .expect(200);

    const site = await request(server)
      .get(`/api/v1/public/${slug}`)
      .expect(200);
    expect(
      asSuccess<{ acceptedPaymentMethods: string[] }>(site.body)
        .acceptedPaymentMethods,
    ).toContain('online');

    const contact = asSuccess<{ id: string }>(
      (
        await staff(request(server).post('/api/v1/contacts'))
          .send({
            type: 'person',
            firstName: 'Fatou',
            email: 'fatou@example.com',
          })
          .expect(201)
      ).body,
    );
    const offer = asSuccess<{ id: string }>(
      (
        await staff(request(server).post('/api/v1/offers'))
          .send({
            type: 'product',
            name: 'Pagne wax',
            status: 'active',
            pricing: { amount: 15000, currency: 'XOF' },
          })
          .expect(201)
      ).body,
    );
    orderId = asSuccess<{ id: string }>(
      (
        await staff(request(server).post('/api/v1/orders'))
          .send({
            contactId: contact.id,
            currency: 'XOF',
            items: [
              {
                offerId: offer.id,
                description: 'Pagne wax',
                quantity: 1,
                unitPrice: 15000,
              },
            ],
          })
          .expect(201)
      ).body,
    ).id;
  });

  it("sends the customer to GeniusPay's checkout, with both keys and the amount in whole XOF", async () => {
    const res = await request(server)
      .post(`/api/v1/public/${slug}/orders/${orderId}/pay`)
      .send({ email: 'fatou@example.com' });
    expect((res.body as { error?: unknown }).error).toBeUndefined();
    expect(res.status).toBe(201);
    expect(asSuccess<{ checkoutUrl: string }>(res.body).checkoutUrl).toBe(
      `https://pay.genius.ci/checkout/${REFERENCE}`,
    );
    const create = gpRequests.find((r) => r.method === 'POST')!;
    expect(create.headers['x-api-key']).toBe('pk_sandbox_e2e');
    expect(create.headers['x-api-secret']).toBe('sk_sandbox_e2e');
    expect(create.body).toMatchObject({
      amount: 15000,
      currency: 'XOF',
      customer: { email: 'fatou@example.com' },
    });
    // Back from GeniusPay, the customer lands on their own order, not an empty tracking form.
    const order = await connection
      .collection('orders')
      .findOne({ _id: new Types.ObjectId(orderId) });
    const back = new URL(
      String((create.body as { success_url?: string }).success_url),
    );
    expect(back.pathname).toBe(`/${slug}/track`);
    expect(Object.fromEntries(back.searchParams)).toEqual({
      kind: 'order',
      number: String(order!.number),
      email: 'fatou@example.com',
      paid: '1',
    });
  });

  async function trackedPayment(): Promise<unknown> {
    const order = await connection
      .collection('orders')
      .findOne({ _id: new Types.ObjectId(orderId) });
    const res = await request(server)
      .get(`/api/v1/public/${slug}/orders/${String(order!.number)}`)
      .query({ email: 'fatou@example.com' })
      .expect(200);
    return asSuccess<{ payment: unknown }>(res.body).payment;
  }

  it('tells the customer back on the tracking page that the payment is still being confirmed', async () => {
    expect(await trackedPayment()).toEqual({ status: 'pending' });
  });

  function deliver(body: object, secret = WEBHOOK_SECRET) {
    const raw = JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', secret)
      .update(`${timestamp}.${raw}`)
      .digest('hex');
    return request(server)
      .post('/api/v1/webhooks/geniuspay')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', signature)
      .set('X-Webhook-Timestamp', String(timestamp))
      .set('X-Webhook-Event', 'payment.success')
      .send(raw);
  }

  it('refuses a webhook not signed with the webhook secret', async () => {
    await deliver(
      {
        id: 'forged',
        event: 'payment.success',
        data: { reference: REFERENCE, status: 'completed' },
      },
      'wrong',
    ).expect(401);
  });

  it("settles the order when GeniusPay's signed webhook arrives — reading the status from GeniusPay", async () => {
    gpStatus[REFERENCE] = 'completed';
    await deliver({
      id: '550e8400-e29b-41d4-a716-446655440000',
      event: 'payment.success',
      data: {
        object: 'transaction',
        reference: REFERENCE,
        status: 'completed',
        amount: 15000,
        currency: 'XOF',
      },
    }).expect(200);

    expect(
      gpRequests.some(
        (r) => r.method === 'GET' && r.url === `/payments/${REFERENCE}`,
      ),
    ).toBe(true);
    const payment = await connection
      .collection('payments')
      .findOne({ providerReference: REFERENCE });
    expect(payment).toMatchObject({
      provider: 'geniuspay',
      status: 'completed',
    });
    const order = await connection
      .collection('orders')
      .findOne({ _id: new Types.ObjectId(orderId) });
    const invoice = await connection
      .collection('invoices')
      .findOne({ _id: order!.invoiceId as Types.ObjectId });
    expect(invoice?.status).toBe('paid');
    expect(await trackedPayment()).toEqual({ status: 'paid' });
  });

  it('records the same delivery once', async () => {
    const before = await connection
      .collection('integration_webhook_events')
      .countDocuments({ provider: 'geniuspay' });
    await deliver({
      id: '550e8400-e29b-41d4-a716-446655440000',
      event: 'payment.success',
      data: { reference: REFERENCE, status: 'completed' },
    }).expect(200);
    expect(
      await connection
        .collection('integration_webhook_events')
        .countDocuments({ provider: 'geniuspay' }),
    ).toBe(before);
  });

  it("settles a business's KORVA plan paid by mobile money, even if it never comes back to the dashboard", async () => {
    const integrations = app.get(IntegrationsService);
    const billing = await integrations.createPlatformAccount({
      domain: 'payment',
      provider: 'geniuspay',
      role: 'subscription-billing',
      market: null,
      secret: 'pk_sandbox_e2e sk_sandbox_e2e',
    });
    await app.get(IntegrationsRepository).updateStatus(billing.id, 'active');

    const subscription = await connection
      .collection('subscriptions')
      .findOne({ organizationId: new Types.ObjectId(organizationId) });
    const now = new Date();
    const { insertedId } = await connection
      .collection('subscription_invoices')
      .insertOne({
        organizationId: new Types.ObjectId(organizationId),
        subscriptionId: subscription!._id,
        planId: subscription!.planId,
        number: 'ABO-E2E-1',
        status: 'open',
        periodStart: now,
        periodEnd: new Date(now.getTime() + 30 * 86_400_000),
        amount: 9900,
        currency: 'XOF',
        issuedAt: now,
        dueAt: now,
        paidAt: null,
        createdAt: now,
        updatedAt: now,
      });

    const checkout = await request(server)
      .post(`/api/v1/subscriptions/invoices/${insertedId.toString()}/checkout`)
      .set('Authorization', `Bearer ${staffToken}`)
      .set('X-Organization-Id', organizationId)
      .send({});
    expect((checkout.body as { error?: unknown }).error).toBeUndefined();
    expect(asSuccess<{ checkoutUrl: string }>(checkout.body).checkoutUrl).toBe(
      `https://pay.genius.ci/checkout/${PLAN_REFERENCE}`,
    );

    gpStatus[PLAN_REFERENCE] = 'completed';
    await deliver({
      id: 'plan-delivery-1',
      event: 'payment.success',
      data: { reference: PLAN_REFERENCE, status: 'completed' },
    }).expect(200);

    const invoice = await connection
      .collection('subscription_invoices')
      .findOne({ _id: insertedId });
    expect(invoice?.status).toBe('paid');
  });

  it('does not offer online payment to a shop selling in a currency GeniusPay does not charge', async () => {
    const auth = await request(server)
      .post('/api/v1/auth/register')
      .send({ email: 'gp-maroc@korva.test', password: 'password123' })
      .expect(201);
    const token = asSuccess<{ accessToken: string }>(auth.body).accessToken;
    const org = asSuccess<{ id: string; slug: string }>(
      (
        await request(server)
          .post('/api/v1/organizations')
          .set('Authorization', `Bearer ${token}`)
          .send({
            name: 'Boutique Casa',
            type: 'commerce',
            country: 'MA',
            currency: 'MAD',
            timezone: 'Africa/Casablanca',
            language: 'fr',
          })
          .expect(201)
      ).body,
    );
    await putOrganizationOnPlan(connection, org.id, 'starter');
    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', org.id)
      .send({
        enabledModules: ['crm', 'catalog', 'commerce', 'finance', 'website'],
        acceptedPaymentMethods: ['cash', 'online'],
      })
      .expect(200);
    const site = await request(server)
      .get(`/api/v1/public/${org.slug}`)
      .expect(200);
    expect(
      asSuccess<{ acceptedPaymentMethods: string[] }>(site.body)
        .acceptedPaymentMethods,
    ).toEqual(['cash']);
  });
});
