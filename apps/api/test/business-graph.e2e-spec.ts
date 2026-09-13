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
}
interface TaskPayload {
  id: string;
}
interface ConversationPayload {
  id: string;
}
interface PipelineStagePayload {
  id: string;
}
interface PipelinePayload {
  id: string;
  stages: PipelineStagePayload[];
}
interface DealPayload {
  id: string;
}
interface OrganizationGraphSummaryPayload {
  crm: {
    openLeadsCount: number;
    openDealsCount: number;
    openDealsValue: number;
  };
  finance: { overdueInvoicesCount: number; overdueInvoicesTotal: number };
  inventory: { lowStockCount: number; deadStockCount: number };
  suppliers: { supplierCount: number; pendingPurchaseOrdersCount: number };
}
interface TimelineEntry {
  type: string;
  id: string;
  occurredAt: string;
  summary: string;
  amount?: number;
}
interface ContactTimelinePayload {
  contactId: string;
  entries: TimelineEntry[];
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

describe('Business Graph module (e2e)', () => {
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
      .send({ enabledModules: ['crm', 'finance', 'communication'] })
      .expect(200);

    const contactRes = await request(server)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        firstName: 'Client',
        lastName: 'Test',
        email: `${email.split('@')[0]}.client@korva.test`,
      })
      .expect(201);
    const contactId = asSuccess<ContactPayload>(contactRes.body).id;

    return { accessToken, organizationId, contactId };
  }

  it('assembles a cross-module timeline for a contact from Quotes, Tasks, and Conversations — most recent first', async () => {
    const { accessToken, organizationId, contactId } =
      await registerOrgAndContact('timeline-owner@korva.test', 'Timeline Org');

    const quoteRes = await request(server)
      .post('/api/v1/quotes')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        contactId,
        currency: 'EUR',
        items: [{ description: 'Consulting', quantity: 1, unitPrice: 150 }],
      })
      .expect(201);
    const quoteId = asSuccess<QuotePayload>(quoteRes.body).id;

    const taskRes = await request(server)
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        title: 'Follow up with client',
        entity: 'contact',
        entityId: contactId,
      })
      .expect(201);
    const taskId = asSuccess<TaskPayload>(taskRes.body).id;

    const conversationRes = await request(server)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ contactId, channel: 'internal', subject: 'Onboarding' })
      .expect(201);
    const conversationId = asSuccess<ConversationPayload>(
      conversationRes.body,
    ).id;

    const res = await request(server)
      .get(`/api/v1/business-graph/contacts/${contactId}/timeline`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    const timeline = asSuccess<ContactTimelinePayload>(res.body);

    expect(timeline.contactId).toBe(contactId);
    const ids = timeline.entries.map((e) => e.id);
    expect(ids).toContain(quoteId);
    expect(ids).toContain(taskId);
    expect(ids).toContain(conversationId);

    const quoteEntry = timeline.entries.find((e) => e.id === quoteId);
    expect(quoteEntry?.type).toBe('quote');
    expect(quoteEntry?.amount).toBe(150);

    // All three were created in quick succession within this test — entries must be sorted
    // most-recent-first (descending occurredAt), so the timestamps should be non-increasing.
    const timestamps = timeline.entries.map((e) =>
      new Date(e.occurredAt).getTime(),
    );
    const sorted = [...timestamps].sort((a, b) => b - a);
    expect(timestamps).toEqual(sorted);
  });

  it('includes a Deal entry in the contact timeline with its estimatedValue as amount (Phase F1)', async () => {
    const { accessToken, organizationId, contactId } =
      await registerOrgAndContact(
        'timeline-deal-owner@korva.test',
        'Timeline Deal Org',
      );

    const pipelineRes = await request(server)
      .post('/api/v1/pipelines')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        name: 'Sales',
        isDefault: true,
        stages: [{ name: 'New', order: 0 }],
      })
      .expect(201);
    const pipeline = asSuccess<PipelinePayload>(pipelineRes.body);

    const dealRes = await request(server)
      .post('/api/v1/deals')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        contactId,
        pipelineId: pipeline.id,
        stageId: pipeline.stages[0]!.id,
        estimatedValue: 300,
      })
      .expect(201);
    const dealId = asSuccess<DealPayload>(dealRes.body).id;

    const res = await request(server)
      .get(`/api/v1/business-graph/contacts/${contactId}/timeline`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    const timeline = asSuccess<ContactTimelinePayload>(res.body);

    const dealEntry = timeline.entries.find((e) => e.id === dealId);
    expect(dealEntry?.type).toBe('deal');
    expect(dealEntry?.amount).toBe(300);
  });

  it('GET /business-graph/organization/summary returns real CRM counts, gated by the analytics module (Phase F1)', async () => {
    const { accessToken, organizationId, contactId } =
      await registerOrgAndContact('summary-owner@korva.test', 'Summary Org');

    // The controller's own module gate (analytics.read) requires 'analytics' — not enabled by
    // registerOrgAndContact's default ['crm','finance','communication'] set.
    const beforeRes = await request(server)
      .get('/api/v1/business-graph/organization/summary')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(403);
    expect(asError(beforeRes.body).code).toBe('MODULE_NOT_ENABLED');

    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        enabledModules: ['crm', 'finance', 'communication', 'analytics'],
      })
      .expect(200);

    await request(server)
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ contactId, source: 'referral' })
      .expect(201);

    const pipelineRes = await request(server)
      .post('/api/v1/pipelines')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        name: 'Sales',
        isDefault: true,
        stages: [{ name: 'New', order: 0 }],
      })
      .expect(201);
    const pipeline = asSuccess<PipelinePayload>(pipelineRes.body);
    await request(server)
      .post('/api/v1/deals')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        contactId,
        pipelineId: pipeline.id,
        stageId: pipeline.stages[0]!.id,
        estimatedValue: 400,
      })
      .expect(201);

    const res = await request(server)
      .get('/api/v1/business-graph/organization/summary')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    const summary = asSuccess<OrganizationGraphSummaryPayload>(res.body);

    expect(summary.crm.openLeadsCount).toBe(1);
    expect(summary.crm.openDealsCount).toBe(1);
    expect(summary.crm.openDealsValue).toBe(400);
    // Never invented — a fresh org has no suppliers/purchase orders/overdue invoices/dead or
    // low stock yet, so every other field is genuinely zero, not omitted or guessed.
    expect(summary.finance.overdueInvoicesCount).toBe(0);
    expect(summary.inventory.lowStockCount).toBe(0);
    expect(summary.inventory.deadStockCount).toBe(0);
    expect(summary.suppliers.supplierCount).toBe(0);
    expect(summary.suppliers.pendingPurchaseOrdersCount).toBe(0);
  });

  it('404s with CONTACT_NOT_FOUND for a contact id that does not exist in this organization', async () => {
    const { accessToken, organizationId } = await registerOrgAndContact(
      'timeline-missing@korva.test',
      'Timeline Missing Org',
    );

    const res = await request(server)
      .get('/api/v1/business-graph/contacts/000000000000000000000000/timeline')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(404);
    expect(asError(res.body).code).toBe('CONTACT_NOT_FOUND');
  });

  it('denies a user from another organization reading a contact timeline via a foreign org id', async () => {
    const a = await registerOrgAndContact(
      'timeline-iso-a@korva.test',
      'Timeline Iso A',
    );
    const b = await registerOrgAndContact(
      'timeline-iso-b@korva.test',
      'Timeline Iso B',
    );

    const res = await request(server)
      .get(`/api/v1/business-graph/contacts/${a.contactId}/timeline`)
      .set('Authorization', `Bearer ${b.accessToken}`)
      .set('X-Organization-Id', a.organizationId)
      .expect(403);
    expect(asError(res.body).code).toBe('ORGANIZATION_ACCESS_DENIED');
  });
});
