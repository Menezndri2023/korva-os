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
  INVOICE_OVERDUE_QUEUE_NAME,
  INVOICE_OVERDUE_SCHEDULER_ID,
} from '../src/finance/invoices/invoice-overdue-scheduler.service';

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
interface InvoicePayload {
  id: string;
  status: string;
  total: number;
  amountPaid: number;
  quoteId?: string;
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
describe('Invoice overdue scheduler (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  let accessToken: string;
  let organizationId: string;
  let contactId: string;

  const intervalMs = 1000;

  beforeAll(async () => {
    process.env.INVOICE_OVERDUE_ENABLED = 'true';
    process.env.INVOICE_OVERDUE_INTERVAL_MS = String(intervalMs);

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
      .send({
        email: 'invoice-overdue-owner@korva.test',
        password: 'password123',
      })
      .expect(201);
    accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Invoice Overdue Org',
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

    const cleanupConnection = new IORedis(
      process.env.REDIS_URL ?? 'redis://localhost:6380',
      { maxRetriesPerRequest: null },
    );
    const cleanupQueue = new Queue(INVOICE_OVERDUE_QUEUE_NAME, {
      connection: cleanupConnection,
    });
    await cleanupQueue.removeJobScheduler(INVOICE_OVERDUE_SCHEDULER_ID);
    await cleanupQueue.close();
    cleanupConnection.disconnect();

    delete process.env.INVOICE_OVERDUE_ENABLED;
    delete process.env.INVOICE_OVERDUE_INTERVAL_MS;
  });

  it(
    'an issued invoice past its dueDate, still carrying a balance, is automatically transitioned to "overdue" and publishes invoice.overdue — proven by a Workflow configured on that trigger actually firing',
    async () => {
      const workflowRes = await request(server)
        .post('/api/v1/workflows')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'On invoice overdue',
          trigger: 'invoice.overdue',
          conditions: [],
          actions: [
            {
              type: 'create_task',
              config: { title: 'Chase overdue invoice {{invoiceId}}' },
            },
          ],
        })
        .expect(201);
      const workflowId = asSuccess<WorkflowPayload>(workflowRes.body).id;

      const invoiceRes = await request(server)
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          currency: 'EUR',
          items: [
            { description: 'Overdue service', quantity: 1, unitPrice: 300 },
          ],
          dueDate: new Date(Date.now() - 60_000).toISOString(),
        })
        .expect(201);
      const invoiceId = asSuccess<InvoicePayload>(invoiceRes.body).id;

      await request(server)
        .post(`/api/v1/invoices/${invoiceId}/issue`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      await waitFor(async () => {
        const res = await request(server)
          .get(`/api/v1/invoices/${invoiceId}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .expect(200);
        const invoice = asSuccess<InvoicePayload>(res.body);
        return invoice.status === 'overdue' ? invoice : undefined;
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
      expect(executions[0]!.eventName).toBe('invoice.overdue');
      expect(executions[0]!.payload.invoiceId).toBe(invoiceId);
    },
    intervalMs * 20,
  );

  it(
    'a paid invoice past its dueDate is left untouched by the sweep',
    async () => {
      const invoiceRes = await request(server)
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          currency: 'EUR',
          items: [{ description: 'Already paid', quantity: 1, unitPrice: 80 }],
          dueDate: new Date(Date.now() - 60_000).toISOString(),
        })
        .expect(201);
      const invoiceId = asSuccess<InvoicePayload>(invoiceRes.body).id;

      await request(server)
        .post(`/api/v1/invoices/${invoiceId}/issue`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      await request(server)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ invoiceId, amount: 80 })
        .expect(201);

      // Let a couple of ticks pass, then confirm the paid invoice was never marked overdue.
      await new Promise((resolve) => setTimeout(resolve, intervalMs * 3));

      const res = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<InvoicePayload>(res.body).status).toBe('paid');
    },
    intervalMs * 6,
  );
});
