import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { EventBusService } from '../src/core/events/event-bus.service';

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
interface ActionCenterSummaryPayload {
  pendingApprovals: number;
  recommendations: number;
  automatedThisWeek: number;
  failures: number;
}
interface ActionCenterItemPayload {
  type: string;
  id: string;
  title: string;
  entityType?: string;
  entityId?: string;
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

describe('Action Center (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  let accessToken: string;
  let organizationId: string;

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
      .send({
        email: 'action-center-owner@korva.test',
        password: 'password123',
      })
      .expect(201);
    accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Action Center Org',
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
      .send({ enabledModules: ['crm', 'finance', 'workflow', 'ai'] })
      .expect(200);

    // One open Recommendation, produced via the real Decision Engine pipeline (event → rule →
    // Recommendation) rather than inserted directly — this is the one item type that already
    // has a real, cheap end-to-end producer available in this session's own work.
    const eventBus = app.get(EventBusService);
    await eventBus.publish(organizationId, 'invoice.overdue', {
      invoiceId: new Types.ObjectId().toString(),
      contactId: new Types.ObjectId().toString(),
      total: 300,
      amountPaid: 100,
    });

    // One pending AI approval and one failed + one successful WorkflowExecution, seeded
    // directly — exercising their real creation flows (a scripted AIProvider override, a
    // genuinely-failing workflow action) belongs to ai.e2e-spec.ts/workflow.e2e-spec.ts; this
    // file's job is the read-aggregation layer over whatever already exists in those
    // collections, which a direct insert exercises identically from ActionCenterService's
    // point of view (it only ever reads these collections, never writes to them).
    await connection.collection('ai_pending_actions').insertOne({
      organizationId: new Types.ObjectId(organizationId),
      conversationId: new Types.ObjectId(),
      toolName: 'send_whatsapp',
      input: {},
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const failingWorkflowId = new Types.ObjectId();
    await connection.collection('workflow_executions').insertMany([
      {
        organizationId: new Types.ObjectId(organizationId),
        workflowId: failingWorkflowId,
        eventName: 'lead.created',
        payload: {},
        status: 'failed',
        actionResults: [],
        error: 'Webhook URL resolves to a disallowed address',
        createdAt: new Date(),
      },
      {
        organizationId: new Types.ObjectId(organizationId),
        workflowId: failingWorkflowId,
        eventName: 'lead.created',
        payload: {},
        status: 'success',
        actionResults: [],
        createdAt: new Date(),
      },
    ]);
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();
  });

  it("summarizes pending approvals, open recommendations, and this week's automated runs/failures", async () => {
    const summary = await waitFor(async () => {
      const res = await request(server)
        .get('/api/v1/action-center/summary')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const data = asSuccess<ActionCenterSummaryPayload>(res.body);
      return data.recommendations > 0 ? data : undefined;
    });

    expect(summary).toEqual<ActionCenterSummaryPayload>({
      pendingApprovals: 1,
      recommendations: 1,
      automatedThisWeek: 1,
      failures: 1,
    });
  });

  it('returns a merged feed with one item per source, most-recent-first', async () => {
    const items = await waitFor(async () => {
      const res = await request(server)
        .get('/api/v1/action-center/feed')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const data = asSuccess<ActionCenterItemPayload[]>(res.body);
      return data.length === 3 ? data : undefined;
    });

    const types = items.map((item) => item.type).sort();
    expect(types).toEqual([
      'pending_approval',
      'recommendation',
      'workflow_failure',
    ]);

    const pendingApproval = items.find(
      (item) => item.type === 'pending_approval',
    );
    expect(pendingApproval?.title).toBe('Confirmation requise : send_whatsapp');

    const failure = items.find((item) => item.type === 'workflow_failure');
    expect(failure?.title).toBe(
      'Échec d\'automatisation pour l\'événement "lead.created"',
    );

    const recommendation = items.find((item) => item.type === 'recommendation');
    expect(recommendation?.entityType).toBe('invoice');
  });

  it('denies a user from another organization reading the action center via a foreign org id', async () => {
    const otherAuthRes = await request(server)
      .post('/api/v1/auth/register')
      .send({
        email: 'action-center-other@korva.test',
        password: 'password123',
      })
      .expect(201);
    const otherAccessToken = asSuccess<AuthPayload>(
      otherAuthRes.body,
    ).accessToken;
    await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${otherAccessToken}`)
      .send({
        name: 'Other Org',
        type: 'service',
        country: 'FR',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        language: 'fr',
      })
      .expect(201);

    const res = await request(server)
      .get('/api/v1/action-center/summary')
      .set('Authorization', `Bearer ${otherAccessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(403);
    expect(asError(res.body).code).toBe('ORGANIZATION_ACCESS_DENIED');
  });
});
