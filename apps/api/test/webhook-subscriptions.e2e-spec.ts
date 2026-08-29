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
interface WebhookSubscriptionPayload {
  id: string;
  url: string;
  events: string[];
  active: boolean;
}
interface CreatedWebhookSubscriptionPayload extends WebhookSubscriptionPayload {
  secret: string;
}
interface WebhookDeliveryPayload {
  id: string;
  eventName: string;
  status: string;
  attempts: number;
  responseStatus?: number;
}
interface ExpensePayload {
  id: string;
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

/**
 * A first-class outbound-webhook subscription system for external partners — distinct from the
 * Workflow Engine's own `webhook` action (no signing, no retry, no dedicated log). See
 * packages/types/src/webhook-subscriptions.ts and docs/BUSINESS_OS_AUDIT.md §6.
 */
describe('Webhook subscriptions (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  let accessToken: string;
  let organizationId: string;
  let originalFetch: typeof global.fetch;
  let fetchMock: jest.Mock;

  beforeAll(async () => {
    originalFetch = global.fetch;

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
      .send({ email: 'webhooks-owner@korva.test', password: 'password123' })
      .expect(201);
    accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Webhooks Org',
        type: 'service',
        country: 'FR',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        language: 'fr',
      })
      .expect(201);
    organizationId = asSuccess<OrganizationPayload>(orgRes.body).id;

    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ enabledModules: ['finance'] })
      .expect(200);
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  /** Isolated org+token for the two delivery-focused tests below — every other test in this file
   *  shares one org and leaves its own subscription active afterward, which would otherwise also
   *  receive a delivery for any expense created later in the file. */
  async function registerFreshOrg(email: string, orgName: string) {
    const authRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email, password: 'password123' })
      .expect(201);
    const freshAccessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${freshAccessToken}`)
      .send({
        name: orgName,
        type: 'service',
        country: 'FR',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        language: 'fr',
      })
      .expect(201);
    const freshOrganizationId = asSuccess<OrganizationPayload>(orgRes.body).id;

    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${freshAccessToken}`)
      .set('X-Organization-Id', freshOrganizationId)
      .send({ enabledModules: ['finance'] })
      .expect(200);

    return {
      accessToken: freshAccessToken,
      organizationId: freshOrganizationId,
    };
  }

  it('rejects an unsafe (private-network) webhook URL', async () => {
    const res = await request(server)
      .post('/api/v1/webhook-subscriptions')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ url: 'https://127.0.0.1/hook', events: ['expense.created'] })
      .expect(400);
    expect(asError(res.body).code).toBe('UNSAFE_WEBHOOK_URL');
  });

  it('rejects an event name outside SYSTEM_EVENTS', async () => {
    const res = await request(server)
      .post('/api/v1/webhook-subscriptions')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ url: 'https://93.184.216.34/hook', events: ['not.a.real.event'] })
      .expect(400);
    expect(asError(res.body).code).toBe('VALIDATION_ERROR');
  });

  it('creates a subscription, returning the secret once — never again on list or get', async () => {
    const createRes = await request(server)
      .post('/api/v1/webhook-subscriptions')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        url: 'https://93.184.216.34/hook-create',
        events: ['expense.created'],
        description: 'Accounting partner',
      })
      .expect(201);
    const created = asSuccess<CreatedWebhookSubscriptionPayload>(
      createRes.body,
    );
    expect(created.secret).toMatch(/^whsec_/);
    expect(created.events).toEqual(['expense.created']);
    expect(created.active).toBe(true);

    const listRes = await request(server)
      .get('/api/v1/webhook-subscriptions')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    const list = asSuccess<WebhookSubscriptionPayload[]>(listRes.body);
    const listed = list.find((s) => s.id === created.id);
    expect(listed).toBeDefined();
    expect(listed).not.toHaveProperty('secret');
    expect(listed).not.toHaveProperty('secretEncrypted');

    const getRes = await request(server)
      .get(`/api/v1/webhook-subscriptions/${created.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    expect(
      asSuccess<WebhookSubscriptionPayload>(getRes.body),
    ).not.toHaveProperty('secret');
  });

  it('updates a subscription and rejects an unsafe URL on update too', async () => {
    const createRes = await request(server)
      .post('/api/v1/webhook-subscriptions')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        url: 'https://93.184.216.34/hook-update',
        events: ['expense.created'],
      })
      .expect(201);
    const id = asSuccess<CreatedWebhookSubscriptionPayload>(createRes.body).id;

    const updateRes = await request(server)
      .patch(`/api/v1/webhook-subscriptions/${id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ active: false })
      .expect(200);
    expect(asSuccess<WebhookSubscriptionPayload>(updateRes.body).active).toBe(
      false,
    );

    const badRes = await request(server)
      .patch(`/api/v1/webhook-subscriptions/${id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ url: 'http://169.254.169.254/hook' })
      .expect(400);
    expect(asError(badRes.body).code).toBe('UNSAFE_WEBHOOK_URL');
  });

  it('rotates the secret, returning a new one each time, and 404s rotating an unknown id', async () => {
    const createRes = await request(server)
      .post('/api/v1/webhook-subscriptions')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        url: 'https://93.184.216.34/hook-rotate',
        events: ['expense.created'],
      })
      .expect(201);
    const created = asSuccess<CreatedWebhookSubscriptionPayload>(
      createRes.body,
    );

    const rotateRes = await request(server)
      .post(`/api/v1/webhook-subscriptions/${created.id}/rotate-secret`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(201);
    const rotated = asSuccess<CreatedWebhookSubscriptionPayload>(
      rotateRes.body,
    );
    expect(rotated.secret).toMatch(/^whsec_/);
    expect(rotated.secret).not.toBe(created.secret);
    expect(rotated.id).toBe(created.id);

    const notFoundRes = await request(server)
      .post(
        '/api/v1/webhook-subscriptions/000000000000000000000000/rotate-secret',
      )
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(404);
    expect(asError(notFoundRes.body).code).toBe(
      'WEBHOOK_SUBSCRIPTION_NOT_FOUND',
    );
  });

  it('deletes a subscription and then 404s fetching it', async () => {
    const createRes = await request(server)
      .post('/api/v1/webhook-subscriptions')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        url: 'https://93.184.216.34/hook-delete',
        events: ['expense.created'],
      })
      .expect(201);
    const id = asSuccess<CreatedWebhookSubscriptionPayload>(createRes.body).id;

    await request(server)
      .delete(`/api/v1/webhook-subscriptions/${id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);

    await request(server)
      .get(`/api/v1/webhook-subscriptions/${id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(404);
  });

  it('signs and delivers the real event to an active subscription, logging a successful delivery', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const fresh = await registerFreshOrg(
      'webhooks-delivery@korva.test',
      'Webhooks Delivery Org',
    );

    const createRes = await request(server)
      .post('/api/v1/webhook-subscriptions')
      .set('Authorization', `Bearer ${fresh.accessToken}`)
      .set('X-Organization-Id', fresh.organizationId)
      .send({
        url: 'https://93.184.216.34/hook-delivery',
        events: ['expense.created'],
      })
      .expect(201);
    const subscriptionId = asSuccess<CreatedWebhookSubscriptionPayload>(
      createRes.body,
    ).id;

    const expenseRes = await request(server)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${fresh.accessToken}`)
      .set('X-Organization-Id', fresh.organizationId)
      .send({
        category: 'office_supplies',
        description: 'Webhook delivery probe',
        amount: 10,
        currency: 'EUR',
        date: new Date().toISOString(),
      })
      .expect(201);
    const expenseId = asSuccess<ExpensePayload>(expenseRes.body).id;

    const deliveries = await waitFor(async () => {
      const res = await request(server)
        .get(`/api/v1/webhook-subscriptions/${subscriptionId}/deliveries`)
        .set('Authorization', `Bearer ${fresh.accessToken}`)
        .set('X-Organization-Id', fresh.organizationId)
        .expect(200);
      const data = asSuccess<WebhookDeliveryPayload[]>(res.body);
      return data.some((d) => d.status === 'success') ? data : undefined;
    });

    const delivery = deliveries.find((d) => d.status === 'success');
    expect(delivery).toBeDefined();
    expect(delivery?.eventName).toBe('expense.created');
    expect(delivery?.responseStatus).toBe(200);
    expect(delivery?.attempts).toBe(1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [
      URL,
      { headers: Record<string, string>; body: string },
    ];
    expect(url.toString()).toBe('https://93.184.216.34/hook-delivery');
    expect(init.headers['X-Korva-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(init.headers['X-Korva-Event']).toBe('expense.created');
    const parsedBody = JSON.parse(init.body) as {
      event: string;
      data: { expenseId: string };
    };
    expect(parsedBody.event).toBe('expense.created');
    expect(parsedBody.data.expenseId).toBe(expenseId);
  }, 20000);

  it('never delivers to an inactive subscription', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const fresh = await registerFreshOrg(
      'webhooks-inactive@korva.test',
      'Webhooks Inactive Org',
    );

    const createRes = await request(server)
      .post('/api/v1/webhook-subscriptions')
      .set('Authorization', `Bearer ${fresh.accessToken}`)
      .set('X-Organization-Id', fresh.organizationId)
      .send({
        url: 'https://93.184.216.34/hook-inactive',
        events: ['expense.created'],
      })
      .expect(201);
    const subscriptionId = asSuccess<CreatedWebhookSubscriptionPayload>(
      createRes.body,
    ).id;

    await request(server)
      .patch(`/api/v1/webhook-subscriptions/${subscriptionId}`)
      .set('Authorization', `Bearer ${fresh.accessToken}`)
      .set('X-Organization-Id', fresh.organizationId)
      .send({ active: false })
      .expect(200);

    await request(server)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${fresh.accessToken}`)
      .set('X-Organization-Id', fresh.organizationId)
      .send({
        category: 'office_supplies',
        description: 'Should not trigger an inactive subscription',
        amount: 5,
        currency: 'EUR',
        date: new Date().toISOString(),
      })
      .expect(201);

    // Give any (incorrect) delivery a real chance to happen before asserting it never did.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(fetchMock).not.toHaveBeenCalled();

    const res = await request(server)
      .get(`/api/v1/webhook-subscriptions/${subscriptionId}/deliveries`)
      .set('Authorization', `Bearer ${fresh.accessToken}`)
      .set('X-Organization-Id', fresh.organizationId)
      .expect(200);
    expect(asSuccess<WebhookDeliveryPayload[]>(res.body)).toHaveLength(0);
  });
});
