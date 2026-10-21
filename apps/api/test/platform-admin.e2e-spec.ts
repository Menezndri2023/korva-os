import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PlatformAdminAuthService } from './../src/platform-admin/platform-admin-auth.service';

interface ApiSuccess<T> {
  success: true;
  data: T;
}

interface AuthPayload {
  accessToken: string;
}
interface OrganizationPayload {
  id: string;
  slug: string;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * L'Administration de KORVA OS: closed to everyone but PLATFORM_ADMIN_EMAILS, and its three
 * actions — assign a plan paid outside the platform, record such a payment, extend a trial.
 * Own file for the register-throttle budget.
 */
describe('Platform administration (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;

  beforeAll(async () => {
    process.env.PLATFORM_ADMIN_EMAILS = 'Ops@Korva.test, lock@korva.test';
    // Only EUR collectable: an XOF shop cannot buy a paid plan by itself — the case an
    // administrator's manual assignment exists for.
    process.env.BILLING_CHARGEABLE_CURRENCIES = 'EUR';
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
    delete process.env.PLATFORM_ADMIN_EMAILS;
    delete process.env.BILLING_CHARGEABLE_CURRENCIES;
    await connection.dropDatabase();
    await app.close();
  });

  async function setupOrg(
    email: string,
    name: string,
    modules: string[],
    locale: { country: string; currency: string; timezone: string } = {
      country: 'FR',
      currency: 'EUR',
      timezone: 'Europe/Paris',
    },
  ) {
    const authRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email, password: 'password123' })
      .expect(201);
    const accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name,
        type: 'services',
        ...locale,
        language: 'fr',
      })
      .expect(201);
    const { id: organizationId, slug } = asSuccess<OrganizationPayload>(
      orgRes.body,
    );

    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ enabledModules: modules })
      .expect(200);

    return { accessToken, organizationId, slug };
  }

  /** Administrators are provisioned on the server (dist/create-platform-admin.js), then sign in
   *  at /platform/auth/login — never through the businesses' /auth. Cached: one sign-in per file. */
  let cachedOpsToken: string | undefined;
  async function opsToken(): Promise<string> {
    if (cachedOpsToken) return cachedOpsToken;
    const { password } = await app
      .get(PlatformAdminAuthService)
      .provision('ops@korva.test');
    const res = await request(server)
      .post('/api/v1/platform/auth/login')
      .send({ email: 'ops@korva.test', password })
      .expect(200);
    cachedOpsToken = asSuccess<AuthPayload>(res.body).accessToken;
    return cachedOpsToken;
  }
  const adminToken = opsToken;

  it('turns away everyone who is not a platform administrator', async () => {
    const tenant = await setupOrg('admin-tenant@korva.test', 'Tenant Shop', [
      'website',
    ]);
    for (const path of ['me', 'overview', 'subscriptions', 'activation']) {
      await request(server)
        .get(`/api/v1/platform/${path}`)
        .set('Authorization', `Bearer ${tenant.accessToken}`)
        .expect(403);
    }
    await request(server)
      .post(`/api/v1/platform/organizations/${tenant.organizationId}/trial`)
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .send({ days: 30 })
      .expect(403);
  });

  it('lets an administrator assign a plan paid outside the platform, record the payment, and extend a trial', async () => {
    const shop = await setupOrg(
      'admin-xof@korva.test',
      'Boutique Abidjan',
      ['website'],
      {
        country: 'CI',
        currency: 'XOF',
        timezone: 'Africa/Abidjan',
      },
    );
    const token = await adminToken();
    const admin = (r: request.Test) =>
      r.set('Authorization', `Bearer ${token}`);

    await admin(request(server).get('/api/v1/platform/me')).expect(200);

    // The owner cannot buy Starter in XOF by themselves here…
    await request(server)
      .post('/api/v1/subscriptions/change-plan')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .set('X-Organization-Id', shop.organizationId)
      .send({ planKey: 'starter' })
      .expect(422);

    // …but an administrator who collected the payment can assign it.
    await admin(
      request(server).post(
        `/api/v1/platform/organizations/${shop.organizationId}/plan`,
      ),
    )
      .send({ planKey: 'starter' })
      .expect(200);
    const detail = asSuccess<{
      subscription: { planKey: string; priceCurrency: string };
      members: { email: string }[];
      recentActivity: { metadata?: { manualPayment?: boolean } }[];
    }>(
      (
        await admin(
          request(server).get(
            `/api/v1/platform/organizations/${shop.organizationId}`,
          ),
        ).expect(200)
      ).body,
    );
    expect(detail.subscription).toMatchObject({
      planKey: 'starter',
      priceCurrency: 'XOF',
    });
    expect(detail.members[0]!.email).toBe('admin-xof@korva.test');
    expect(
      detail.recentActivity.some((entry) => entry.metadata?.manualPayment),
    ).toBe(true);

    // Recording a payment received by Mobile Money settles the open invoice, once.
    const subscription = await connection
      .collection('subscriptions')
      .findOne({ organizationId: new Types.ObjectId(shop.organizationId) });
    const invoiceId = new Types.ObjectId();
    await connection.collection('subscription_invoices').insertOne({
      _id: invoiceId,
      organizationId: new Types.ObjectId(shop.organizationId),
      subscriptionId: subscription!._id,
      planId: subscription!.planId,
      number: 'KSUB-TEST-0001',
      amount: 9900,
      currency: 'XOF',
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 30 * DAY_MS),
      dueAt: new Date(Date.now() + 7 * DAY_MS),
      status: 'open',
    });
    const paidPath = `/api/v1/platform/organizations/${shop.organizationId}/invoices/${invoiceId.toString()}/paid`;
    const first = asSuccess<{ settled: boolean }>(
      (await admin(request(server).post(paidPath)).expect(200)).body,
    );
    expect(first.settled).toBe(true);
    const again = asSuccess<{ settled: boolean }>(
      (await admin(request(server).post(paidPath)).expect(200)).body,
    );
    expect(again.settled).toBe(false);

    // Extending a trial opens one from now when none runs.
    const before = Date.now();
    await admin(
      request(server).post(
        `/api/v1/platform/organizations/${shop.organizationId}/trial`,
      ),
    )
      .send({ days: 10 })
      .expect(200);
    const trialSub = await connection
      .collection('subscriptions')
      .findOne({ organizationId: new Types.ObjectId(shop.organizationId) });
    expect((trialSub!.trialEndsAt as Date).getTime()).toBeGreaterThanOrEqual(
      before + 10 * DAY_MS - 1000,
    );

    // Out-of-range input is refused.
    await admin(
      request(server).post(
        `/api/v1/platform/organizations/${shop.organizationId}/trial`,
      ),
    )
      .send({ days: 400 })
      .expect(400);
  });

  it('gives the administrator the overview and the subscription list', async () => {
    const token = await opsToken();
    const overview = asSuccess<{
      organizations: number;
      organizationsByPlan: Record<string, number>;
      monthlyRevenueByCurrency: Record<string, number>;
    }>(
      (
        await request(server)
          .get('/api/v1/platform/overview')
          .set('Authorization', `Bearer ${token}`)
          .expect(200)
      ).body,
    );
    expect(overview.organizations).toBeGreaterThanOrEqual(2);
    expect(overview.organizationsByPlan.starter).toBe(1);
    expect(overview.monthlyRevenueByCurrency.XOF).toBeGreaterThan(0);

    const paid = asSuccess<{ organizationName: string; planKey: string }[]>(
      (
        await request(server)
          .get('/api/v1/platform/subscriptions?filter=paid')
          .set('Authorization', `Bearer ${token}`)
          .expect(200)
      ).body,
    );
    expect(paid.map((row) => row.organizationName)).toEqual([
      'Boutique Abidjan',
    ]);
  });

  it('suspends an organization — dashboard blocked, site offline — and reactivates it intact', async () => {
    const shop = await setupOrg(
      'admin-suspend@korva.test',
      'Shop A Suspendre',
      ['website', 'catalog'],
    );
    const token = await opsToken();
    const asOwner = (r: request.Test) =>
      r
        .set('Authorization', `Bearer ${shop.accessToken}`)
        .set('X-Organization-Id', shop.organizationId);

    await request(server).get(`/api/v1/public/${shop.slug}`).expect(200);

    await request(server)
      .post(`/api/v1/platform/organizations/${shop.organizationId}/suspend`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Impayé depuis 2 mois' })
      .expect(200);

    const blocked = await asOwner(
      request(server).get('/api/v1/organizations/me'),
    ).expect(403);
    expect((blocked.body as { error: { code: string } }).error.code).toBe(
      'ORGANIZATION_SUSPENDED',
    );
    await request(server).get(`/api/v1/public/${shop.slug}`).expect(404);
    // Still listed among the owner's organizations, so the dashboard can explain.
    await request(server)
      .get('/api/v1/organizations/me/all')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .expect(200);

    await request(server)
      .post(`/api/v1/platform/organizations/${shop.organizationId}/reactivate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await asOwner(request(server).get('/api/v1/organizations/me')).expect(200);
    await request(server).get(`/api/v1/public/${shop.slug}`).expect(200);

    // A reason is required.
    await request(server)
      .post(`/api/v1/platform/organizations/${shop.organizationId}/suspend`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: '' })
      .expect(400);
  });

  it('lists every business with its trade, and groups the overview by trade', async () => {
    const token = await opsToken();
    const salon = await setupOrg('admin-salon@korva.test', 'Salon Test', [
      'website',
    ]);
    await connection
      .collection('organizations')
      .updateOne(
        { _id: new Types.ObjectId(salon.organizationId) },
        { $set: { businessModel: 'appointments' } },
      );
    await connection.collection('bookings').insertOne({
      organizationId: new Types.ObjectId(salon.organizationId),
      createdAt: new Date(),
    });

    const rows = asSuccess<
      { id: string; channel: string; activity30d: number; planKey: string }[]
    >(
      (
        await request(server)
          .get('/api/v1/platform/businesses')
          .set('Authorization', `Bearer ${token}`)
          .expect(200)
      ).body,
    );
    const row = rows.find((entry) => entry.id === salon.organizationId)!;
    // A salon is measured on bookings, not on shop orders.
    expect(row).toMatchObject({
      channel: 'bookings',
      activity30d: 1,
      planKey: 'free',
    });

    const overview = asSuccess<{
      byBusinessModel: {
        businessModel: string;
        organizations: number;
        activity30d: number;
      }[];
    }>(
      (
        await request(server)
          .get('/api/v1/platform/overview')
          .set('Authorization', `Bearer ${token}`)
          .expect(200)
      ).body,
    );
    expect(
      overview.byBusinessModel.find(
        (group) => group.businessModel === 'appointments',
      ),
    ).toMatchObject({
      organizations: 1,
      activity30d: 1,
    });
  });

  it('manages accounts: search, disable (sign-in refused), enable, password reset — never its own', async () => {
    const token = await opsToken();
    const admin = (r: request.Test) =>
      r.set('Authorization', `Bearer ${token}`);
    const member = await setupOrg(
      'admin-user-target@korva.test',
      'User Target Shop',
      ['website'],
    );

    const found = asSuccess<
      { id: string; email: string; organizations: { name: string }[] }[]
    >(
      (
        await admin(
          request(server).get('/api/v1/platform/users?q=user-target'),
        ).expect(200)
      ).body,
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.organizations[0]!.name).toBe('User Target Shop');
    const userId = found[0]!.id;

    await admin(
      request(server).post(`/api/v1/platform/users/${userId}/disable`),
    ).expect(200);
    const refused = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'admin-user-target@korva.test', password: 'password123' })
      .expect(403);
    expect((refused.body as { error: { code: string } }).error.code).toBe(
      'ACCOUNT_DISABLED',
    );

    await admin(
      request(server).post(`/api/v1/platform/users/${userId}/enable`),
    ).expect(200);
    await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'admin-user-target@korva.test', password: 'password123' })
      .expect(201);

    await admin(
      request(server).post(`/api/v1/platform/users/${userId}/password-reset`),
    ).expect(200);

    expect(member.slug).toBeTruthy();
  });

  it('shows the plan catalog, the platform-wide audit trail and the system state', async () => {
    const token = await opsToken();
    const get = (path: string) =>
      request(server)
        .get(`/api/v1/platform/${path}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

    const plans = asSuccess<
      { key: string; priceCurrency: string; subscribers: number }[]
    >((await get('plans')).body);
    expect(
      plans.some((plan) => plan.key === 'pro' && plan.priceCurrency === 'XOF'),
    ).toBe(true);

    // A paginated list: rows in `data`, the pagination beside it at the top level.
    const auditBody = (await get('audit')).body as {
      data: { organizationName: string; metadata: Record<string, unknown> }[];
      pagination: { total: number };
    };
    expect(auditBody.pagination.total).toBeGreaterThan(0);
    expect(
      auditBody.data.some((row) => row.metadata.by === 'platform_admin'),
    ).toBe(true);

    const system = asSuccess<{
      database: { dataBytes: number };
      email: { configured: boolean };
      administrators: number;
    }>((await get('system')).body);
    expect(system.database.dataBytes).toBeGreaterThan(0);
    expect(system.administrators).toBe(2);
  });

  it('has its own sign-in: no business account gets in, and its token opens no business', async () => {
    const auth = app.get(PlatformAdminAuthService);
    const tenant = await setupOrg(
      'admin-signin-tenant@korva.test',
      'Signin Shop',
      ['website'],
    );

    // A business user's token is refused by the administration.
    await request(server)
      .get('/api/v1/platform/me')
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .expect(403);

    // Only addresses listed in PLATFORM_ADMIN_EMAILS can be provisioned.
    await expect(auth.provision('intruder@korva.test')).rejects.toThrow();

    // An administrator's token opens no business route.
    const token = await opsToken();
    await request(server)
      .get('/api/v1/organizations/me/all')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);

    // Repeated wrong passwords lock the account.
    await auth.provision('lock@korva.test');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(server)
        .post('/api/v1/platform/auth/login')
        .send({ email: 'lock@korva.test', password: 'wrong-password' })
        .expect(401);
    }
    const locked = await request(server)
      .post('/api/v1/platform/auth/login')
      .send({ email: 'lock@korva.test', password: 'wrong-password' })
      .expect(403);
    expect((locked.body as { error: { code: string } }).error.code).toBe(
      'ACCOUNT_LOCKED',
    );

    // Re-provisioning gives a new password and unlocks; the administrator can then choose theirs.
    const { password } = await auth.provision('lock@korva.test');
    const signedIn = asSuccess<AuthPayload>(
      (
        await request(server)
          .post('/api/v1/platform/auth/login')
          .send({ email: 'lock@korva.test', password })
          .expect(200)
      ).body,
    );
    await request(server)
      .post('/api/v1/platform/auth/password')
      .set('Authorization', `Bearer ${signedIn.accessToken}`)
      .send({
        currentPassword: password,
        newPassword: 'Un-Mot-De-Passe-Choisi-1',
      })
      .expect(200);
    await request(server)
      .post('/api/v1/platform/auth/login')
      .send({ email: 'lock@korva.test', password: 'Un-Mot-De-Passe-Choisi-1' })
      .expect(200);

    // Removing the address from the configuration revokes the administrator at once.
    process.env.PLATFORM_ADMIN_EMAILS = 'Ops@Korva.test';
    try {
      await request(server)
        .get('/api/v1/platform/me')
        .set('Authorization', `Bearer ${signedIn.accessToken}`)
        .expect(403);
    } finally {
      process.env.PLATFORM_ADMIN_EMAILS = 'Ops@Korva.test, lock@korva.test';
    }
  });
});
