import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { SubscriptionsRepository } from '../src/subscriptions/subscriptions.repository';
import {
  SUBSCRIPTION_PERIOD_QUEUE_NAME,
  SUBSCRIPTION_PERIOD_SCHEDULER_ID,
} from '../src/subscriptions/subscription-period-scheduler.service';

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

describe('Subscriptions module (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  let subscriptionsRepository: SubscriptionsRepository;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    server = app.getHttpServer();
    connection = app.get(getConnectionToken());
    subscriptionsRepository = app.get(SubscriptionsRepository);
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
      await request(server)
        .patch('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ enabledModules: ['ai'] })
        .expect(200);

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

  describe('cancellation and reactivation', () => {
    async function currentStatus(organizationId: string) {
      const doc = await connection.collection('subscriptions').findOne({
        organizationId: new Types.ObjectId(organizationId),
      });
      return doc as unknown as {
        status: string;
        cancelAtPeriodEnd: boolean;
        cancelRequestedAt: Date | null;
        canceledAt: Date | null;
        currentPeriodEnd: Date;
      };
    }

    it('immediate=true revokes access now: status becomes "canceled" right away', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'cancel-immediate@korva.test',
        'Cancel Immediate Org',
      );

      const res = await request(server)
        .post('/api/v1/subscriptions/cancel')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ immediate: true })
        .expect(201);
      const body = asSuccess<SubscriptionPayload>(res.body);
      expect(body.status).toBe('canceled');

      const doc = await currentStatus(organizationId);
      expect(doc.status).toBe('canceled');
      expect(doc.canceledAt).not.toBeNull();
      expect(doc.cancelAtPeriodEnd).toBe(false);
    });

    it('immediate=false (default) stays "active" until currentPeriodEnd, only flagging cancelAtPeriodEnd', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'cancel-at-period-end@korva.test',
        'Cancel At Period End Org',
      );

      const res = await request(server)
        .post('/api/v1/subscriptions/cancel')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({})
        .expect(201);
      const body = asSuccess<SubscriptionPayload>(res.body);
      expect(body.status).toBe('active');

      const doc = await currentStatus(organizationId);
      expect(doc.status).toBe('active');
      expect(doc.cancelAtPeriodEnd).toBe(true);
      expect(doc.cancelRequestedAt).not.toBeNull();
    });

    it('canceling an already-canceled subscription is a conflict, not a silent success', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'cancel-twice@korva.test',
        'Cancel Twice Org',
      );

      await request(server)
        .post('/api/v1/subscriptions/cancel')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ immediate: true })
        .expect(201);

      const res = await request(server)
        .post('/api/v1/subscriptions/cancel')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ immediate: true })
        .expect(409);
      expect(asError(res.body).code).toBe('SUBSCRIPTION_CANCEL_CONFLICT');
    });

    it('reactivate undoes a pending cancel-at-period-end request while still within the grace window', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'reactivate-ok@korva.test',
        'Reactivate Ok Org',
      );

      await request(server)
        .post('/api/v1/subscriptions/cancel')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ immediate: false })
        .expect(201);

      const res = await request(server)
        .post('/api/v1/subscriptions/reactivate')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      const body = asSuccess<SubscriptionPayload>(res.body);
      expect(body.status).toBe('active');

      const doc = await currentStatus(organizationId);
      expect(doc.cancelAtPeriodEnd).toBe(false);
      expect(doc.cancelRequestedAt).toBeNull();
    });

    it('reactivate fails once the grace window has already elapsed, even before the scheduler ticks', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'reactivate-expired@korva.test',
        'Reactivate Expired Org',
      );

      await request(server)
        .post('/api/v1/subscriptions/cancel')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ immediate: false })
        .expect(201);

      // Simulate the grace window having already elapsed — no need to wait for the real
      // scheduler tick, since reactivateIfEligible's guard checks currentPeriodEnd directly.
      await connection
        .collection('subscriptions')
        .updateOne(
          { organizationId: new Types.ObjectId(organizationId) },
          { $set: { currentPeriodEnd: new Date(Date.now() - 60_000) } },
        );

      const res = await request(server)
        .post('/api/v1/subscriptions/reactivate')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(409);
      expect(asError(res.body).code).toBe(
        'SUBSCRIPTION_REACTIVATE_NOT_ELIGIBLE',
      );
    });

    it('reactivate fails on an immediately-canceled subscription — there is no grace window for that', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'reactivate-immediate@korva.test',
        'Reactivate Immediate Org',
      );

      await request(server)
        .post('/api/v1/subscriptions/cancel')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ immediate: true })
        .expect(201);

      const res = await request(server)
        .post('/api/v1/subscriptions/reactivate')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(409);
      expect(asError(res.body).code).toBe(
        'SUBSCRIPTION_REACTIVATE_NOT_ELIGIBLE',
      );
    });

    it('denies a non-owner from canceling or reactivating the subscription', async () => {
      const owner = await registerOrgAndToken(
        'cancel-perm-owner@korva.test',
        'Cancel Perm Org',
      );
      const staffAuthRes = await request(server)
        .post('/api/v1/auth/register')
        .send({
          email: 'cancel-perm-staff@korva.test',
          password: 'password123',
        })
        .expect(201);
      const staffToken = asSuccess<AuthPayload>(staffAuthRes.body).accessToken;

      const staffRole = await connection.collection('roles').findOne({
        organizationId: new Types.ObjectId(owner.organizationId),
        systemKey: 'STAFF',
      });

      await request(server)
        .post('/api/v1/organizations/me/members')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set('X-Organization-Id', owner.organizationId)
        .send({
          email: 'cancel-perm-staff@korva.test',
          roleId: String(staffRole?._id),
        })
        .expect(201);

      const cancelRes = await request(server)
        .post('/api/v1/subscriptions/cancel')
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', owner.organizationId)
        .send({ immediate: true })
        .expect(403);
      expect(asError(cancelRes.body).code).toBe('PERMISSION_DENIED');

      const reactivateRes = await request(server)
        .post('/api/v1/subscriptions/reactivate')
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', owner.organizationId)
        .expect(403);
      expect(asError(reactivateRes.body).code).toBe('PERMISSION_DENIED');
    });

    it('denies a user from another organization from canceling via a foreign org id', async () => {
      const a = await registerOrgAndToken(
        'cancel-iso-a@korva.test',
        'Cancel Iso A',
      );
      const b = await registerOrgAndToken(
        'cancel-iso-b@korva.test',
        'Cancel Iso B',
      );

      const res = await request(server)
        .post('/api/v1/subscriptions/cancel')
        .set('Authorization', `Bearer ${b.accessToken}`)
        .set('X-Organization-Id', a.organizationId)
        .send({ immediate: true })
        .expect(403);
      expect(asError(res.body).code).toBe('ORGANIZATION_ACCESS_DENIED');

      // Confirm org A's subscription was genuinely untouched by the rejected cross-tenant call.
      const doc = await currentStatus(a.organizationId);
      expect(doc.status).toBe('active');
    });
  });

  /**
   * Wave 3 fix: EntitlementsService now checks `subscription.status` before its three
   * consuming/growing checks (module enablement, seat addition, AI usage recording) — see
   * EntitlementsService's own doc comment for the full policy reasoning. Before this fix, an
   * immediately-canceled organization ("revokes access now" per the test above) kept full access
   * to all three regardless of status.
   */
  describe('entitlements lockout once a subscription is canceled', () => {
    // Deliberately consolidated into as few registerOrgAndToken calls as possible: this file's
    // AUTH_THROTTLE (30 auth/register per 60s, see auth.controller.ts) is a real anti-abuse
    // control shared by every test in this describe block's single app instance, and this suite
    // already runs close to that limit.
    it('rejects enabling a module and inviting a member with SUBSCRIPTION_CANCELED after an immediate cancel, while the subscription summary keeps working', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'lockout-org@korva.test',
        'Lockout Org',
      );
      const staffRole = await connection.collection('roles').findOne({
        organizationId: new Types.ObjectId(organizationId),
        systemKey: 'STAFF',
      });

      await request(server)
        .post('/api/v1/subscriptions/cancel')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ immediate: true })
        .expect(201);

      const moduleRes = await request(server)
        .patch('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ enabledModules: ['crm'] })
        .expect(403);
      expect(asError(moduleRes.body).code).toBe('SUBSCRIPTION_CANCELED');

      // assertSeatAvailable runs before the invited email is even looked up, so the lockout
      // fires regardless of whether that email belongs to a real user — no need to register one.
      const seatRes = await request(server)
        .post('/api/v1/organizations/me/members')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          email: 'nonexistent-lockout-invitee@korva.test',
          roleId: String(staffRole?._id),
        })
        .expect(403);
      expect(asError(seatRes.body).code).toBe('SUBSCRIPTION_CANCELED');

      const summaryRes = await request(server)
        .get('/api/v1/subscriptions/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(
        asSuccess<SubscriptionSummaryPayload>(summaryRes.body).subscription
          .status,
      ).toBe('canceled');
    });

    it('rejects AI usage with SUBSCRIPTION_CANCELED after an immediate cancel, even under the usage quota', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'lockout-ai@korva.test',
        'Lockout AI Org',
      );
      await request(server)
        .patch('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ enabledModules: ['ai'] })
        .expect(200);

      await request(server)
        .post('/api/v1/subscriptions/cancel')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ immediate: true })
        .expect(201);

      const res = await request(server)
        .post('/api/v1/ai/chat')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ message: 'Bonjour' })
        .expect(403);
      expect(asError(res.body).code).toBe('SUBSCRIPTION_CANCELED');
    });

    it('a pending cancel-at-period-end (status still "active") does NOT lock out access — the grace period already granted by cancelAtPeriodEnd', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'lockout-grace@korva.test',
        'Lockout Grace Org',
      );

      await request(server)
        .post('/api/v1/subscriptions/cancel')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ immediate: false })
        .expect(201);

      await request(server)
        .patch('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ enabledModules: ['crm'] })
        .expect(200);
    });
  });

  describe('proration on plan change', () => {
    it('a mid-period upgrade stores a positive prorationAmount; a same-plan "change" right after a fresh period stores null', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'proration-e2e@korva.test',
        'Proration E2E Org',
      );

      const res = await request(server)
        .post('/api/v1/subscriptions/change-plan')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ planKey: 'pro' })
        .expect(201);
      const body = asSuccess<
        SubscriptionPayload & {
          prorationAmount: number | null;
          prorationCurrency: string | null;
        }
      >(res.body);
      // A brand-new "free" subscription's period just started (createDefaultSubscription runs
      // moments before this request in the same test), so there is a full month remaining —
      // proration should be close to the full price delta (free=0 -> pro=99).
      expect(body.prorationCurrency).toBe('EUR');
      expect(body.prorationAmount).toBeGreaterThan(90);
    });
  });

  describe('event coverage: subscription.plan_changed', () => {
    it('publishes subscription.plan_changed, verified by a Workflow configured on it actually firing', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'plan-change-event-e2e@korva.test',
        'Plan Change Event Org',
      );
      // Brand-new orgs start with enabledModules: [] — 'workflow' must be turned on explicitly
      // before POST /workflows (gated by @RequireModule('workflow')) will even accept this.
      // 'pro' (not 'starter') on purpose: starter excludes the workflow module, and
      // changePlan strips any enabledModules the new plan doesn't include — switching to
      // starter would silently turn workflow back off before this test could observe it fire.
      await request(server)
        .patch('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ enabledModules: ['workflow'] })
        .expect(200);

      const workflowRes = await request(server)
        .post('/api/v1/workflows')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'On plan changed',
          trigger: 'subscription.plan_changed',
          conditions: [],
          actions: [
            {
              type: 'create_task',
              config: { title: 'Review plan change {{subscriptionId}}' },
            },
          ],
        })
        .expect(201);
      const workflowId = asSuccess<WorkflowPayload>(workflowRes.body).id;

      await request(server)
        .post('/api/v1/subscriptions/change-plan')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ planKey: 'pro' })
        .expect(201);

      const executions = await waitFor(async () => {
        const res = await request(server)
          .get(`/api/v1/workflows/${workflowId}/executions`)
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .expect(200);
        const data = asSuccess<WorkflowExecutionPayload[]>(res.body);
        return data.length > 0 ? data : undefined;
      });

      expect(executions).toHaveLength(1);
      expect(executions[0]!.status).toBe('success');
      expect(executions[0]!.eventName).toBe('subscription.plan_changed');
      expect(executions[0]!.payload.planKey).toBe('pro');
      expect(executions[0]!.payload.previousPlanKey).toBe('free');
    }, 20000);
  });

  /**
   * Exercises the SAME atomic filter-guarded methods SubscriptionPeriodSchedulerService calls
   * during its sweep (cancelIfEligible/renewIfEligible), directly and concurrently, against this
   * describe block's app instance where the real scheduler is NOT running (NODE_ENV=test default
   * -disable — see subscription-period-scheduler.service.ts's isEnabled()) — so there is no race
   * with a live scheduler tick, only the two calls under test.
   */
  describe('scheduler idempotency under concurrent execution', () => {
    async function pushPeriodEndIntoPast(
      organizationId: string,
    ): Promise<void> {
      await connection
        .collection('subscriptions')
        .updateOne(
          { organizationId: new Types.ObjectId(organizationId) },
          { $set: { currentPeriodEnd: new Date(Date.now() - 60_000) } },
        );
    }

    it('two concurrent renewIfEligible calls on the same past-due, non-canceling subscription: exactly one succeeds', async () => {
      const { organizationId } = await registerOrgAndToken(
        'sched-concurrent-renew@korva.test',
        'Sched Concurrent Renew Org',
      );
      await pushPeriodEndIntoPast(organizationId);
      const candidate = await connection.collection('subscriptions').findOne({
        organizationId: new Types.ObjectId(organizationId),
      });
      const subscriptionId = String(candidate!._id);
      const oldPeriodEnd = new Date(candidate!.currentPeriodEnd as Date);
      const newStart = oldPeriodEnd;
      const newEnd = new Date(oldPeriodEnd);
      newEnd.setUTCMonth(newEnd.getUTCMonth() + 1);

      // Both calls race against the SAME eligibility filter (status:'active',
      // cancelAtPeriodEnd:false, currentPeriodEnd < now) — only the first write can still match
      // it; the second necessarily observes a currentPeriodEnd already back in the future.
      const [resultA, resultB] = await Promise.all([
        subscriptionsRepository.renewIfEligible(
          organizationId,
          subscriptionId,
          newStart,
          newEnd,
        ),
        subscriptionsRepository.renewIfEligible(
          organizationId,
          subscriptionId,
          newStart,
          newEnd,
        ),
      ]);

      const successes = [resultA, resultB].filter((r) => r !== null);
      expect(successes.length).toBe(1);

      const doc = await connection.collection('subscriptions').findOne({
        organizationId: new Types.ObjectId(organizationId),
      });
      expect(new Date(doc!.currentPeriodEnd as Date).getTime()).toBe(
        newEnd.getTime(),
      );
    });

    it('two concurrent cancelIfEligible calls on the same past-due, cancelAtPeriodEnd subscription: exactly one succeeds', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'sched-concurrent-cancel@korva.test',
        'Sched Concurrent Cancel Org',
      );
      await request(server)
        .post('/api/v1/subscriptions/cancel')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ immediate: false })
        .expect(201);
      await pushPeriodEndIntoPast(organizationId);
      const candidate = await connection.collection('subscriptions').findOne({
        organizationId: new Types.ObjectId(organizationId),
      });
      const subscriptionId = String(candidate!._id);

      const [resultA, resultB] = await Promise.all([
        subscriptionsRepository.cancelIfEligible(
          organizationId,
          subscriptionId,
        ),
        subscriptionsRepository.cancelIfEligible(
          organizationId,
          subscriptionId,
        ),
      ]);

      const successes = [resultA, resultB].filter((r) => r !== null);
      expect(successes.length).toBe(1);

      const doc = await connection.collection('subscriptions').findOne({
        organizationId: new Types.ObjectId(organizationId),
      });
      expect(doc?.status).toBe('canceled');
    });
  });
});

/**
 * SubscriptionPeriodSchedulerService — the BullMQ repeatable job that automatically resolves
 * Subscriptions past their currentPeriodEnd, exactly like ReconciliationSchedulerService /
 * QuoteExpirySchedulerService / InvoiceOverdueSchedulerService do for their own entities (see
 * that file's own header comment for the full architecture rationale). Disabled by default under
 * NODE_ENV=test for the same reason as those three: the full e2e suite boots many separate
 * NestApplications against the SAME Redis/Mongo, and a live sweep firing on a timer no test
 * controls would be flaky. SUBSCRIPTION_PERIOD_ENABLED/_INTERVAL_MS override that for this file's
 * own dedicated AppModule instance only.
 */
describe('Subscription period scheduler (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;

  const intervalMs = 1000;

  beforeAll(async () => {
    process.env.SUBSCRIPTION_PERIOD_ENABLED = 'true';
    process.env.SUBSCRIPTION_PERIOD_INTERVAL_MS = String(intervalMs);

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

    // The BullMQ repeatable schedule lives in Redis, keyed by SUBSCRIPTION_PERIOD_SCHEDULER_ID,
    // not in-process — closing the app's Worker/Queue does not remove it (see
    // payment-reconciliation-scheduler.e2e-spec.ts for the identical cleanup rationale).
    const cleanupConnection = new IORedis(
      process.env.REDIS_URL ?? 'redis://localhost:6380',
      { maxRetriesPerRequest: null },
    );
    const cleanupQueue = new Queue(SUBSCRIPTION_PERIOD_QUEUE_NAME, {
      connection: cleanupConnection,
    });
    await cleanupQueue.removeJobScheduler(SUBSCRIPTION_PERIOD_SCHEDULER_ID);
    await cleanupQueue.close();
    cleanupConnection.disconnect();

    delete process.env.SUBSCRIPTION_PERIOD_ENABLED;
    delete process.env.SUBSCRIPTION_PERIOD_INTERVAL_MS;
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

  async function pushPeriodEndIntoPast(organizationId: string): Promise<void> {
    await connection
      .collection('subscriptions')
      .updateOne(
        { organizationId: new Types.ObjectId(organizationId) },
        { $set: { currentPeriodEnd: new Date(Date.now() - 60_000) } },
      );
  }

  async function waitUntil(
    check: () => Promise<boolean>,
    timeoutMs: number,
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(`waitUntil: condition not met within ${timeoutMs}ms`);
  }

  it(
    'a non-canceling subscription past currentPeriodEnd is automatically renewed: period advances by one month, status stays "active"',
    async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'sched-renew@korva.test',
        'Sched Renew Org',
      );
      await pushPeriodEndIntoPast(organizationId);
      // Captured AFTER the push — this is the exact currentPeriodEnd the scheduler will read and
      // advance from, not the original one set at subscription creation.
      const before = await connection.collection('subscriptions').findOne({
        organizationId: new Types.ObjectId(organizationId),
      });

      await waitUntil(async () => {
        const doc = await connection.collection('subscriptions').findOne({
          organizationId: new Types.ObjectId(organizationId),
        });
        return (
          !!doc && new Date(doc.currentPeriodEnd as Date).getTime() > Date.now()
        );
      }, intervalMs * 8);

      const after = await connection.collection('subscriptions').findOne({
        organizationId: new Types.ObjectId(organizationId),
      });
      expect(after?.status).toBe('active');
      expect(
        new Date(after!.currentPeriodEnd as Date).getTime(),
      ).toBeGreaterThan(Date.now());
      // Advanced from the OLD period end (one month later), not from "now".
      const expectedNewEnd = new Date(before!.currentPeriodEnd as Date);
      expectedNewEnd.setUTCMonth(expectedNewEnd.getUTCMonth() + 1);
      expect(new Date(after!.currentPeriodStart as Date).getTime()).toBe(
        new Date(before!.currentPeriodEnd as Date).getTime(),
      );
      expect(new Date(after!.currentPeriodEnd as Date).getTime()).toBe(
        expectedNewEnd.getTime(),
      );

      // Confirm the API also reflects the renewal.
      const res = await request(server)
        .get('/api/v1/subscriptions/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(
        asSuccess<SubscriptionSummaryPayload>(res.body).subscription.status,
      ).toBe('active');
    },
    intervalMs * 12,
  );

  it(
    'a cancelAtPeriodEnd subscription past currentPeriodEnd is automatically transitioned to "canceled"',
    async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'sched-cancel@korva.test',
        'Sched Cancel Org',
      );
      await request(server)
        .post('/api/v1/subscriptions/cancel')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ immediate: false })
        .expect(201);
      await pushPeriodEndIntoPast(organizationId);

      await waitUntil(async () => {
        const doc = await connection.collection('subscriptions').findOne({
          organizationId: new Types.ObjectId(organizationId),
        });
        return doc?.status === 'canceled';
      }, intervalMs * 8);

      const doc = await connection.collection('subscriptions').findOne({
        organizationId: new Types.ObjectId(organizationId),
      });
      expect(doc?.status).toBe('canceled');
      expect(doc?.canceledAt).not.toBeNull();
    },
    intervalMs * 12,
  );

  it(
    'a subscription whose currentPeriodEnd has not passed is left untouched by the sweep',
    async () => {
      const { organizationId } = await registerOrgAndToken(
        'sched-untouched@korva.test',
        'Sched Untouched Org',
      );

      await new Promise((resolve) => setTimeout(resolve, intervalMs * 3));

      const doc = await connection.collection('subscriptions').findOne({
        organizationId: new Types.ObjectId(organizationId),
      });
      expect(doc?.status).toBe('active');
      expect(doc?.cancelAtPeriodEnd).toBe(false);
    },
    intervalMs * 6,
  );
});
