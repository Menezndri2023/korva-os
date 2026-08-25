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
  enabledModules: string[];
}
interface PlanPayload {
  key: string;
  modules: string[];
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

/**
 * P0-ORG-01: a freshly created organization must default to every module its plan actually
 * allows, not an empty enabledModules array — otherwise every module (CRM, Catalog, Booking,
 * Commerce, Finance, Analytics, Workflow, Communication, AI) is undiscoverable until someone
 * opts each one in manually via Settings.
 */
describe('Organizations module — default enabledModules on creation (e2e)', () => {
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

  async function registerOrgAndToken(email: string, orgName: string) {
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
        type: 'services',
        country: 'FR',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        language: 'fr',
      })
      .expect(201);
    const organization = asSuccess<OrganizationPayload>(orgRes.body);

    return { accessToken, organization };
  }

  it('gives a freshly created organization a non-empty enabledModules matching its "free" plan modules', async () => {
    const { accessToken, organization } = await registerOrgAndToken(
      'org-default-modules@korva.test',
      'Default Modules Org',
    );

    expect(organization.enabledModules.length).toBeGreaterThan(0);

    const plansRes = await request(server)
      .get('/api/v1/plans')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const freePlan = asSuccess<PlanPayload[]>(plansRes.body).find(
      (p) => p.key === 'free',
    );
    expect(freePlan).toBeDefined();

    expect([...organization.enabledModules].sort()).toEqual(
      [...(freePlan?.modules ?? [])].sort(),
    );

    // Re-fetch via GET to confirm the persisted value matches what creation returned.
    const meRes = await request(server)
      .get('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .expect(200);
    const persisted = asSuccess<OrganizationPayload>(meRes.body);
    expect([...persisted.enabledModules].sort()).toEqual(
      [...(freePlan?.modules ?? [])].sort(),
    );
  });

  it('still rejects enabling a module outside the plan after downgrading (entitlement enforcement unchanged)', async () => {
    const { accessToken, organization } = await registerOrgAndToken(
      'org-default-modules-gate@korva.test',
      'Default Modules Gate Org',
    );

    await request(server)
      .post('/api/v1/subscriptions/change-plan')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .send({ planKey: 'starter' })
      .expect(201);

    // "starter" excludes "workflow" and "ai" — attempting to (re-)enable "workflow" must
    // still be rejected even though it was part of the org's original default modules.
    const res = await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .send({ enabledModules: ['crm', 'workflow'] })
      .expect(403);
    expect(asError(res.body).code).toBe('MODULE_NOT_IN_PLAN');
  });
});
