import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import {
  CUSTOMER_INACTIVITY_QUEUE_NAME,
  CUSTOMER_INACTIVITY_SCHEDULER_ID,
  CustomerInactivitySchedulerService,
} from '../src/crm/contacts/customer-inactivity-scheduler.service';
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

/** Mirrors quote-expiry-scheduler.e2e-spec.ts's own waitFor helper — small deliberate
 *  duplication across scheduler e2e files rather than a shared cross-file import. */
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

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const intervalMs = 1000;

describe('Customer inactivity scheduler (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  let accessToken: string;
  let organizationId: string;
  let workflowId: string;
  let inactiveContactId: string;
  let activeContactId: string;

  beforeAll(async () => {
    // Left disabled for the module's own automatic onModuleInit() during app.init() below
    // (NODE_ENV=test already disables it by default — see isEnabled()). All fixtures are built
    // with no scheduler running at all, then the scheduler is started deterministically, by
    // hand, once every fixture is fully committed — see the comment right before that call for
    // why racing a live scheduler clock against beforeAll's own setup is not viable here.
    process.env.CUSTOMER_INACTIVITY_INTERVAL_MS = String(intervalMs);
    process.env.CUSTOMER_INACTIVITY_THRESHOLD_DAYS = '1';

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
        email: 'customer-inactivity-owner@korva.test',
        password: 'password123',
      })
      .expect(201);
    accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Customer Inactivity Org',
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

    const workflowRes = await request(server)
      .post('/api/v1/workflows')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        name: 'On customer inactive',
        trigger: 'customer.inactive',
        conditions: [],
        actions: [
          {
            type: 'create_task',
            config: { title: 'Reach out to {{contactId}}' },
          },
        ],
      })
      .expect(201);
    workflowId = asSuccess<WorkflowPayload>(workflowRes.body).id;

    // Old contact, zero activity ever — the simplest possible inactivity case.
    const inactiveRes = await request(server)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        firstName: 'Client',
        lastName: 'Inactive',
        email: 'inactive@korva.test',
      })
      .expect(201);
    inactiveContactId = asSuccess<ContactPayload>(inactiveRes.body).id;
    await connection
      .collection('contacts')
      .updateOne(
        { _id: new Types.ObjectId(inactiveContactId) },
        { $set: { createdAt: new Date(Date.now() - 3 * ONE_DAY_MS) } },
      );

    // Old contact, but recent activity (a Quote) — must stay untouched.
    const activeRes = await request(server)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        firstName: 'Client',
        lastName: 'Active',
        email: 'active@korva.test',
      })
      .expect(201);
    activeContactId = asSuccess<ContactPayload>(activeRes.body).id;
    await connection
      .collection('contacts')
      .updateOne(
        { _id: new Types.ObjectId(activeContactId) },
        { $set: { createdAt: new Date(Date.now() - 3 * ONE_DAY_MS) } },
      );
    await request(server)
      .post('/api/v1/quotes')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        contactId: activeContactId,
        currency: 'EUR',
        items: [{ description: 'Still engaged', quantity: 1, unitPrice: 10 }],
      })
      .expect(201);

    // Every fixture above is now fully committed. BullMQ's upsertJobScheduler fires its FIRST
    // occurrence immediately (confirmed empirically against this repo's real bullmq version —
    // not documented behavior to rely on blindly), then every `every` ms after — so starting
    // the scheduler any earlier (e.g. relying on its own automatic onModuleInit() during
    // app.init() above, with CUSTOMER_INACTIVITY_ENABLED set from the start) would race that
    // immediate first tick against all the setup above, and did, intermittently, before this
    // was changed. Calling onModuleInit() by hand, now, removes that race entirely: the first
    // tick it schedules is guaranteed to run against this exact, fully-written state.
    process.env.CUSTOMER_INACTIVITY_ENABLED = 'true';
    await app.get(CustomerInactivitySchedulerService).onModuleInit();
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();

    // Same cleanup rationale as quote-expiry/invoice-overdue's own e2e files: the BullMQ
    // repeatable schedule lives in Redis keyed by the scheduler id, not in-process.
    const cleanupConnection = new IORedis(
      process.env.REDIS_URL ?? 'redis://localhost:6380',
      { maxRetriesPerRequest: null },
    );
    const cleanupQueue = new Queue(CUSTOMER_INACTIVITY_QUEUE_NAME, {
      connection: cleanupConnection,
    });
    await cleanupQueue.removeJobScheduler(CUSTOMER_INACTIVITY_SCHEDULER_ID);
    await cleanupQueue.close();
    cleanupConnection.disconnect();

    delete process.env.CUSTOMER_INACTIVITY_ENABLED;
    delete process.env.CUSTOMER_INACTIVITY_INTERVAL_MS;
    delete process.env.CUSTOMER_INACTIVITY_THRESHOLD_DAYS;
  });

  async function getExecutions(): Promise<WorkflowExecutionPayload[]> {
    const res = await request(server)
      .get(`/api/v1/workflows/${workflowId}/executions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    return asSuccess<WorkflowExecutionPayload[]>(res.body);
  }

  it(
    'flags only the truly inactive contact — proven by a Workflow configured on customer.inactive actually firing — and never re-notifies the same episode',
    async () => {
      const executions = await waitFor(async () => {
        const data = await getExecutions();
        return data.length > 0 ? data : undefined;
      }, intervalMs * 8);

      expect(executions).toHaveLength(1);
      expect(executions[0]!.status).toBe('success');
      expect(executions[0]!.eventName).toBe('customer.inactive');
      expect(executions[0]!.payload.contactId).toBe(inactiveContactId);

      // Give the scheduler a few more ticks, then confirm no second execution appeared for
      // either contact — the atomic claim (Contact.inactiveNotifiedAt) must prevent re-firing
      // for the same inactivity episode, and the active contact must never fire at all.
      await new Promise((resolve) => setTimeout(resolve, intervalMs * 3));
      const later = await getExecutions();
      expect(later).toHaveLength(1);
      expect(later.some((e) => e.payload.contactId === activeContactId)).toBe(
        false,
      );
    },
    intervalMs * 15,
  );
});
