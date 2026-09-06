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
interface ContactPayload {
  id: string;
}
interface RecommendationPayload {
  id: string;
  ruleKey: string;
  entityType: string;
  entityId: string;
  status: string;
  title: string;
  description: string;
  severity: string;
  impact?: string;
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

describe('Decision Engine (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  let accessToken: string;
  let organizationId: string;
  let contactId: string;

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
        email: 'decision-engine-owner@korva.test',
        password: 'password123',
      })
      .expect(201);
    accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Decision Engine Org',
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
  });

  async function listRecommendations(): Promise<RecommendationPayload[]> {
    const res = await request(server)
      .get('/api/v1/recommendations')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    return asSuccess<RecommendationPayload[]>(res.body);
  }

  it('recommends a follow-up when an invoice.overdue event arrives, and never creates a duplicate for the same invoice on a re-published (retried) event', async () => {
    const invoiceId = new Types.ObjectId().toString();
    const eventBus = app.get(EventBusService);
    await eventBus.publish(organizationId, 'invoice.overdue', {
      invoiceId,
      contactId,
      total: 300,
      amountPaid: 100,
    });

    const recommendations = await waitFor(async () => {
      const data = await listRecommendations();
      return data.length > 0 ? data : undefined;
    });

    expect(recommendations).toHaveLength(1);
    const recommendation = recommendations[0]!;
    expect(recommendation.ruleKey).toBe('invoice_overdue_followup');
    expect(recommendation.entityType).toBe('invoice');
    expect(recommendation.entityId).toBe(invoiceId);
    expect(recommendation.status).toBe('open');
    expect(recommendation.description).toContain('200');
    // Phase B1 (docs/KORVA_OS_V2_AUDIT.md §2.2) — an overdue invoice is the highest-urgency
    // Decision Engine rule, with a real (not invented) monetary impact figure.
    expect(recommendation.severity).toBe('urgent');
    expect(recommendation.impact).toContain('200');

    // Same organizationId/eventName/payload republished — simulates a producer retry. Must
    // never create a second Recommendation for the same invoice.
    await eventBus.publish(organizationId, 'invoice.overdue', {
      invoiceId,
      contactId,
      total: 300,
      amountPaid: 100,
    });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(await listRecommendations()).toHaveLength(1);
  }, 20000);

  it('recommends a reactivation campaign when a customer.inactive event arrives, and supports dismiss/resolve with correct invalid-transition handling', async () => {
    const reactivationContactRes = await request(server)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ firstName: 'Client', lastName: 'Dormant' })
      .expect(201);
    const dormantContactId = asSuccess<ContactPayload>(
      reactivationContactRes.body,
    ).id;

    const eventBus = app.get(EventBusService);
    await eventBus.publish(organizationId, 'customer.inactive', {
      contactId: dormantContactId,
      inactiveDays: 61,
    });

    const recommendation = await waitFor(async () => {
      const data = await listRecommendations();
      return data.find((r) => r.entityId === dormantContactId);
    });

    expect(recommendation.ruleKey).toBe('customer_reactivation');
    expect(recommendation.entityType).toBe('contact');
    expect(recommendation.status).toBe('open');
    expect(recommendation.description).toContain('61 jours');
    expect(recommendation.severity).toBe('opportunity');
    expect(recommendation.impact).toContain('61');

    await request(server)
      .post(`/api/v1/recommendations/${recommendation.id}/dismiss`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(201);

    const afterDismissRes = await request(server)
      .get(`/api/v1/recommendations/${recommendation.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    expect(asSuccess<RecommendationPayload>(afterDismissRes.body).status).toBe(
      'dismissed',
    );

    const reResolveRes = await request(server)
      .post(`/api/v1/recommendations/${recommendation.id}/resolve`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(400);
    expect(asError(reResolveRes.body).code).toBe(
      'RECOMMENDATION_INVALID_TRANSITION',
    );
  }, 20000);

  it('denies a STAFF member from dismissing a recommendation while still allowing read', async () => {
    const staffAuthRes = await request(server)
      .post('/api/v1/auth/register')
      .send({
        email: 'decision-engine-staff@korva.test',
        password: 'password123',
      })
      .expect(201);
    const staffToken = asSuccess<AuthPayload>(staffAuthRes.body).accessToken;

    const staffRole = await connection.collection('roles').findOne({
      organizationId: new Types.ObjectId(organizationId),
      systemKey: 'STAFF',
    });
    expect(staffRole).not.toBeNull();

    await request(server)
      .post('/api/v1/organizations/me/members')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        email: 'decision-engine-staff@korva.test',
        roleId: String(staffRole?._id),
      })
      .expect(201);

    const listRes = await request(server)
      .get('/api/v1/recommendations')
      .set('Authorization', `Bearer ${staffToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    const recommendations = asSuccess<RecommendationPayload[]>(listRes.body);
    expect(recommendations.length).toBeGreaterThan(0);

    const dismissRes = await request(server)
      .post(`/api/v1/recommendations/${recommendations[0]!.id}/dismiss`)
      .set('Authorization', `Bearer ${staffToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(403);
    expect(asError(dismissRes.body).code).toBe('PERMISSION_DENIED');
  });

  it('denies a user from another organization reading recommendations via a foreign org id', async () => {
    const otherAuthRes = await request(server)
      .post('/api/v1/auth/register')
      .send({
        email: 'decision-engine-other@korva.test',
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
      .get('/api/v1/recommendations')
      .set('Authorization', `Bearer ${otherAccessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(403);
    expect(asError(res.body).code).toBe('ORGANIZATION_ACCESS_DENIED');
  });
});
