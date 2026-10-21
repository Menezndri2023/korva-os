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
    process.env.PLATFORM_ADMIN_EMAILS = 'Ops@Korva.test';
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

  async function adminToken(): Promise<string> {
    const res = await request(server)
      .post('/api/v1/auth/register')
      .send({ email: 'ops@korva.test', password: 'password123' })
      .expect(201);
    return asSuccess<AuthPayload>(res.body).accessToken;
  }

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
    const token = await adminToken().catch(async () => {
      // Already registered by the previous test: log in instead.
      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'ops@korva.test', password: 'password123' })
        .expect(201);
      return asSuccess<AuthPayload>(res.body).accessToken;
    });
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
});
