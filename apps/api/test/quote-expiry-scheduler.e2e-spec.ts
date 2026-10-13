import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import {
  QUOTE_EXPIRY_QUEUE_NAME,
  QUOTE_EXPIRY_SCHEDULER_ID,
} from '../src/finance/quotes/quote-expiry-scheduler.service';
import { putOrganizationOnPlan } from './support/plan-tier';

interface ApiSuccess<T> {
  success: true;
  data: T;
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
interface WorkflowPayload {
  id: string;
}
interface WorkflowExecutionPayload {
  status: string;
  eventName: string;
  payload: Record<string, unknown>;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}

/**
 * Polls until `check` returns a defined value or `timeoutMs` elapses. Mirrors
 * workflow.e2e-spec.ts's own `waitFor` helper (out of scope to import from, hence the small
 * duplication — same rationale as the original finance.e2e-spec.ts copy this was split from).
 */
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

// Split out of finance.e2e-spec.ts (which was otherwise approaching/exceeding AUTH_THROTTLE's
// 30 registrations/60s budget for a single e2e file — see the identical rationale in
// catalog.e2e-spec.ts / payment-reconciliation.e2e-spec.ts). This describe block was already
// fully self-contained (its own app/beforeAll/afterAll), so moving it here gives it a fresh
// per-file throttle budget with no behavior change.
describe('Quote expiry scheduler (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  let accessToken: string;
  let organizationId: string;
  let contactId: string;

  const intervalMs = 1000;

  beforeAll(async () => {
    process.env.QUOTE_EXPIRY_ENABLED = 'true';
    process.env.QUOTE_EXPIRY_INTERVAL_MS = String(intervalMs);

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
      .send({ email: 'quote-expiry-owner@korva.test', password: 'password123' })
      .expect(201);
    accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Quote Expiry Org',
        type: 'service',
        country: 'FR',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        language: 'fr',
      })
      .expect(201);
    organizationId = asSuccess<OrganizationPayload>(orgRes.body).id;

    await putOrganizationOnPlan(connection, organizationId);
    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ enabledModules: ['crm', 'finance', 'workflow'] })
      .expect(200);

    const contactRes = await request(server)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ firstName: 'Client', lastName: 'Test' })
      .expect(201);
    contactId = asSuccess<ContactPayload>(contactRes.body).id;
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();

    // The BullMQ repeatable schedule lives in Redis, keyed by QUOTE_EXPIRY_SCHEDULER_ID, not
    // in-process — closing the app's Worker/Queue does not remove it (see
    // payment-reconciliation-scheduler.e2e-spec.ts for the identical cleanup rationale).
    const cleanupConnection = new IORedis(
      process.env.REDIS_URL ?? 'redis://localhost:6380',
      { maxRetriesPerRequest: null },
    );
    const cleanupQueue = new Queue(QUOTE_EXPIRY_QUEUE_NAME, {
      connection: cleanupConnection,
    });
    await cleanupQueue.removeJobScheduler(QUOTE_EXPIRY_SCHEDULER_ID);
    await cleanupQueue.close();
    cleanupConnection.disconnect();

    delete process.env.QUOTE_EXPIRY_ENABLED;
    delete process.env.QUOTE_EXPIRY_INTERVAL_MS;
  });

  it(
    'a quote past validUntil, still in a non-terminal status, is automatically transitioned to "expired" and publishes quote.expired — proven by a Workflow configured on that trigger actually firing',
    async () => {
      const workflowRes = await request(server)
        .post('/api/v1/workflows')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'On quote expired',
          trigger: 'quote.expired',
          conditions: [],
          actions: [
            {
              type: 'create_task',
              config: { title: 'Follow up on expired quote {{quoteId}}' },
            },
          ],
        })
        .expect(201);
      const workflowId = asSuccess<WorkflowPayload>(workflowRes.body).id;

      const quoteRes = await request(server)
        .post('/api/v1/quotes')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          currency: 'EUR',
          items: [
            { description: 'Expiring service', quantity: 1, unitPrice: 100 },
          ],
          validUntil: new Date(Date.now() - 60_000).toISOString(),
        })
        .expect(201);
      const quoteId = asSuccess<QuotePayload>(quoteRes.body).id;

      await waitFor(async () => {
        const res = await request(server)
          .get(`/api/v1/quotes/${quoteId}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .expect(200);
        const quote = asSuccess<QuotePayload>(res.body);
        return quote.status === 'expired' ? quote : undefined;
      }, intervalMs * 8);

      const executions = await waitFor(async () => {
        const res = await request(server)
          .get(`/api/v1/workflows/${workflowId}/executions`)
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .expect(200);
        const data = asSuccess<WorkflowExecutionPayload[]>(res.body);
        return data.length > 0 ? data : undefined;
      }, intervalMs * 8);
      expect(executions[0]!.status).toBe('success');
      expect(executions[0]!.eventName).toBe('quote.expired');
      expect(executions[0]!.payload.quoteId).toBe(quoteId);
    },
    intervalMs * 20,
  );

  it(
    'a quote whose validUntil has not passed is left untouched by the sweep',
    async () => {
      const quoteRes = await request(server)
        .post('/api/v1/quotes')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          currency: 'EUR',
          items: [
            { description: 'Not yet expiring', quantity: 1, unitPrice: 50 },
          ],
          validUntil: new Date(Date.now() + 3600_000).toISOString(),
        })
        .expect(201);
      const quoteId = asSuccess<QuotePayload>(quoteRes.body).id;

      // Let a couple of ticks pass, then confirm it is still 'draft'.
      await new Promise((resolve) => setTimeout(resolve, intervalMs * 3));

      const res = await request(server)
        .get(`/api/v1/quotes/${quoteId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<QuotePayload>(res.body).status).toBe('draft');
    },
    intervalMs * 6,
  );
});
