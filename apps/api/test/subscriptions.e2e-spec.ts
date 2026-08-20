import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
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
interface PlanPayload {
  id: string;
  key: string;
  modules: string[];
  limits: Record<string, number>;
}
interface SubscriptionPayload {
  id: string;
  planId: string;
  status: string;
}
interface SubscriptionSummaryPayload {
  subscription: SubscriptionPayload;
  plan: PlanPayload;
  usage: { metric: string; used: number; limit: number }[];
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

describe('Subscriptions module (e2e)', () => {
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
    const organizationId = asSuccess<OrganizationPayload>(orgRes.body).id;

    return { accessToken, organizationId };
  }

  describe('plan catalog and default subscription', () => {
    it('lists the seeded plan catalog', async () => {
      const authRes = await request(server)
        .post('/api/v1/auth/register')
        .send({ email: 'plans-viewer@korva.test', password: 'password123' })
        .expect(201);
      const accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

      const res = await request(server)
        .get('/api/v1/plans')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      const plans = asSuccess<PlanPayload[]>(res.body);
      expect(plans.map((p) => p.key).sort()).toEqual([
        'business',
        'free',
        'pro',
        'starter',
      ]);
    });

    it('creates a default "free" subscription when an organization is created', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'sub-default@korva.test',
        'Sub Default Org',
      );

      const res = await request(server)
        .get('/api/v1/subscriptions/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const summary = asSuccess<SubscriptionSummaryPayload>(res.body);
      expect(summary.plan.key).toBe('free');
      expect(summary.subscription.status).toBe('active');
      expect(summary.usage.find((u) => u.metric === 'seats')?.used).toBe(1);
    });
  });

  describe('module gating driven by the active plan', () => {
    it('rejects enabling a module the current plan does not include, after downgrading to "starter"', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'module-gate@korva.test',
        'Module Gate Org',
      );

      await request(server)
        .post('/api/v1/subscriptions/change-plan')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ planKey: 'starter' })
        .expect(201);

      const res = await request(server)
        .patch('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ enabledModules: ['crm', 'workflow'] })
        .expect(403);
      expect(asError(res.body).code).toBe('MODULE_NOT_IN_PLAN');

      await request(server)
        .patch('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ enabledModules: ['crm', 'catalog'] })
        .expect(200);
    });

    it('denies a non-owner from changing the plan', async () => {
      const owner = await registerOrgAndToken(
        'plan-perm-owner@korva.test',
        'Plan Perm Org',
      );
      const staffAuthRes = await request(server)
        .post('/api/v1/auth/register')
        .send({ email: 'plan-perm-staff@korva.test', password: 'password123' })
        .expect(201);
      const staffToken = asSuccess<AuthPayload>(staffAuthRes.body).accessToken;

      const staffRole = await connection.collection('roles').findOne({
        organizationId: new Types.ObjectId(owner.organizationId),
        systemKey: 'STAFF',
      });
      expect(staffRole).not.toBeNull();

      await request(server)
        .post('/api/v1/organizations/me/members')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set('X-Organization-Id', owner.organizationId)
        .send({
          email: 'plan-perm-staff@korva.test',
          roleId: String(staffRole?._id),
        })
        .expect(201);

      const res = await request(server)
        .post('/api/v1/subscriptions/change-plan')
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', owner.organizationId)
        .send({ planKey: 'pro' })
        .expect(403);
      expect(asError(res.body).code).toBe('PERMISSION_DENIED');
    });
  });

  describe('seat limit enforcement', () => {
    it('rejects inviting a member beyond the "free" plan seat limit (3, owner included)', async () => {
      const owner = await registerOrgAndToken(
        'seat-limit-owner@korva.test',
        'Seat Limit Org',
      );

      const staffRole = await connection.collection('roles').findOne({
        organizationId: new Types.ObjectId(owner.organizationId),
        systemKey: 'STAFF',
      });

      for (const email of ['seat-2@korva.test', 'seat-3@korva.test']) {
        await request(server)
          .post('/api/v1/auth/register')
          .send({ email, password: 'password123' })
          .expect(201);
        await request(server)
          .post('/api/v1/organizations/me/members')
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .set('X-Organization-Id', owner.organizationId)
          .send({ email, roleId: String(staffRole?._id) })
          .expect(201);
      }

      await request(server)
        .post('/api/v1/auth/register')
        .send({ email: 'seat-4@korva.test', password: 'password123' })
        .expect(201);
      const res = await request(server)
        .post('/api/v1/organizations/me/members')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set('X-Organization-Id', owner.organizationId)
        .send({ email: 'seat-4@korva.test', roleId: String(staffRole?._id) })
        .expect(403);
      expect(asError(res.body).code).toBe('SEAT_LIMIT_REACHED');
    });
  });

  describe('AI usage quota enforcement', () => {
    it('allows up to the "free" plan limit (5 messages/month) then rejects the next one', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'ai-quota@korva.test',
        'AI Quota Org',
      );

      for (let i = 0; i < 5; i++) {
        await request(server)
          .post('/api/v1/ai/chat')
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .send({ message: `Bonjour ${i}` })
          .expect(201);
      }

      const res = await request(server)
        .post('/api/v1/ai/chat')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ message: 'Un de trop' })
        .expect(403);
      expect(asError(res.body).code).toBe('USAGE_LIMIT_REACHED');
    });
  });

  describe('tenant isolation for subscriptions', () => {
    it('denies a user from another organization reading the subscription via a foreign org id', async () => {
      const a = await registerOrgAndToken('sub-iso-a@korva.test', 'Sub Iso A');
      const b = await registerOrgAndToken('sub-iso-b@korva.test', 'Sub Iso B');

      const res = await request(server)
        .get('/api/v1/subscriptions/me')
        .set('Authorization', `Bearer ${b.accessToken}`)
        .set('X-Organization-Id', a.organizationId)
        .expect(403);
      expect(asError(res.body).code).toBe('ORGANIZATION_ACCESS_DENIED');
    });
  });
});
