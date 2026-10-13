import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { putOrganizationOnPlan } from './support/plan-tier';

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
interface SubscriptionPayload {
  id: string;
  planId: string;
  status: string;
  productOverrides?: Record<string, boolean>;
}
interface SubscriptionSummaryPayload {
  subscription: SubscriptionPayload;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

/**
 * Split into its own spec file rather than appended to subscriptions.e2e-spec.ts: these tests
 * plus that file's existing ones register more orgs via POST /auth/register than the endpoint's
 * AUTH_THROTTLE (30 requests / 60s) allows within one test run — same reasoning documented in
 * payment-reconciliation.e2e-spec.ts's own header comment. Each e2e spec file boots its own
 * NestApplication with its own in-memory ThrottlerStorage, so a separate file gets a fresh
 * budget.
 */
describe('Subscription product overrides (e2e)', () => {
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

  it('a false override strips a product-only module but a cross-cutting module survives if another product still grants it', async () => {
    const { accessToken, organizationId } = await registerOrgAndToken(
      'product-override-crosscut@korva.test',
      'Product Override Crosscut Org',
    );

    // Starter grants every module except `ai`, which is Pro's — a real plan with real
    // cross-cutting modules to test against. (`workflow` was excluded here too until
    // 2026-10-13; it is free now, because all seventeen vertical templates depend on it.)
    await request(server)
      .post('/api/v1/subscriptions/change-plan')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ planKey: 'starter' })
      .expect(201);

    await request(server)
      .patch('/api/v1/subscriptions/product-overrides')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ productOverrides: { inventory: false } })
      .expect(200);

    // catalog/commerce belong only to "inventory" -> no longer allowed.
    const res = await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ enabledModules: ['crm', 'catalog'] })
      .expect(403);
    expect(asError(res.body).code).toBe('MODULE_NOT_IN_PLAN');

    // finance is shared with "crm", which was never overridden -> still allowed alongside crm.
    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ enabledModules: ['crm', 'finance'] })
      .expect(200);
  });

  it('revokes an already-enabled module from live enabledModules once the product granting it is overridden false', async () => {
    const { accessToken, organizationId } = await registerOrgAndToken(
      'product-override-revoke@korva.test',
      'Product Override Revoke Org',
    );

    // Starter, and finance enabled explicitly. Until 2026-10-13 this ran on the free plan
    // with no PATCH at all, because the demonstration catalog gave `free` all eleven modules
    // and createForOwner copies plan.modules verbatim. `finance` is a Starter module now, so
    // the tier has to be real before the module can be, and this test needs finance present:
    // it is the one that must SURVIVE the override, proving the prune is per-product and not
    // a blanket reset.
    await putOrganizationOnPlan(connection, organizationId, 'starter');
    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ enabledModules: ['crm', 'catalog', 'commerce', 'finance'] })
      .expect(200);

    const before = await request(server)
      .get('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    const beforeModules = asSuccess<{ enabledModules: string[] }>(
      before.body,
    ).enabledModules;
    expect(beforeModules).toContain('catalog');
    expect(beforeModules).toContain('commerce');
    expect(beforeModules).toContain('finance');

    await request(server)
      .patch('/api/v1/subscriptions/product-overrides')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ productOverrides: { inventory: false } })
      .expect(200);

    const after = await request(server)
      .get('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    const afterModules = asSuccess<{ enabledModules: string[] }>(
      after.body,
    ).enabledModules;
    // Not just "not allowed to re-enable" — actually pruned out of the live, ModuleGuard-
    // enforced array. finance survives (still granted by crm, untouched).
    expect(afterModules).not.toContain('catalog');
    expect(afterModules).not.toContain('commerce');
    expect(afterModules).toContain('finance');
  });

  it('round-trips a product override through GET /subscriptions/me', async () => {
    const { accessToken, organizationId } = await registerOrgAndToken(
      'product-override-roundtrip@korva.test',
      'Product Override Roundtrip Org',
    );

    await request(server)
      .patch('/api/v1/subscriptions/product-overrides')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ productOverrides: { website: true, ai: false } })
      .expect(200);

    const res = await request(server)
      .get('/api/v1/subscriptions/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    const summary = asSuccess<SubscriptionSummaryPayload>(res.body);
    expect(summary.subscription.productOverrides).toEqual({
      website: true,
      ai: false,
    });
  });

  it('denies a non-owner from changing product overrides', async () => {
    const owner = await registerOrgAndToken(
      'product-override-perm-owner@korva.test',
      'Product Override Perm Org',
    );
    const staffAuthRes = await request(server)
      .post('/api/v1/auth/register')
      .send({
        email: 'product-override-perm-staff@korva.test',
        password: 'password123',
      })
      .expect(201);
    const staffToken = asSuccess<AuthPayload>(staffAuthRes.body).accessToken;

    const staffRole = await connection.collection('roles').findOne({
      organizationId: new Types.ObjectId(owner.organizationId),
      systemKey: 'STAFF',
    });
    expect(staffRole).not.toBeNull();

    // Starter, for its five seats: the free plan is a single seat, the owner's, and this test
    // needs a staff member to exist before it can check that one may not change overrides.
    await putOrganizationOnPlan(connection, owner.organizationId, 'starter');

    await request(server)
      .post('/api/v1/organizations/me/members')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set('X-Organization-Id', owner.organizationId)
      .send({
        email: 'product-override-perm-staff@korva.test',
        roleId: String(staffRole?._id),
      })
      .expect(201);

    const res = await request(server)
      .patch('/api/v1/subscriptions/product-overrides')
      .set('Authorization', `Bearer ${staffToken}`)
      .set('X-Organization-Id', owner.organizationId)
      .send({ productOverrides: { ai: true } })
      .expect(403);
    expect(asError(res.body).code).toBe('PERMISSION_DENIED');
  });

  it('a plan downgrade does not strip a module kept alive purely by a true product override', async () => {
    const { accessToken, organizationId } = await registerOrgAndToken(
      'product-override-downgrade@korva.test',
      'Product Override Downgrade Org',
    );

    // Pro first, because an override may only be switched ON for a product the active plan
    // already grants — assertOverridesWithinPlan, which exists so that a tenant's own OWNER
    // cannot hand itself a paid product for free. This test ran straight from the free plan
    // until 2026-10-13, when `free` still granted all eleven modules and the call was a no-op
    // entitlement-wise. The behaviour under test is unchanged and is now actually reachable:
    // an override survives a plan change that would otherwise remove the module.
    await request(server)
      .post('/api/v1/subscriptions/change-plan')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ planKey: 'pro' })
      .expect(201);

    await request(server)
      .patch('/api/v1/subscriptions/product-overrides')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ productOverrides: { ai: true } })
      .expect(200);
    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ enabledModules: ['crm', 'ai'] })
      .expect(200);

    // "starter" excludes "ai" entirely — so only the override can keep it alive.
    await request(server)
      .post('/api/v1/subscriptions/change-plan')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ planKey: 'starter' })
      .expect(201);

    const res = await request(server)
      .get('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    expect(
      asSuccess<{ enabledModules: string[] }>(res.body).enabledModules,
    ).toContain('ai');
  });
});
