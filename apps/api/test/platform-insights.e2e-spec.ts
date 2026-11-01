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
function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The administration's cross-cutting views: what waits for an action, KORVA's money, the global
 * search, internal notes and the payment accounts — all closed to a business user's token.
 */
describe('Platform administration — insights (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  let adminToken: string;
  let ownerToken: string;
  let organizationId: string;
  const admin = (req: request.Test) =>
    req.set('Authorization', `Bearer ${adminToken}`);

  beforeAll(async () => {
    process.env.PLATFORM_ADMIN_EMAILS = 'insights@korva.test';
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

    const { password } = await app
      .get(PlatformAdminAuthService)
      .provision('insights@korva.test');
    adminToken = asSuccess<{ accessToken: string }>(
      (
        await request(server)
          .post('/api/v1/platform/auth/login')
          .send({ email: 'insights@korva.test', password })
          .expect(200)
      ).body,
    ).accessToken;

    ownerToken = asSuccess<{ accessToken: string }>(
      (
        await request(server)
          .post('/api/v1/auth/register')
          .send({ email: 'awa@salon-insights.ci', password: 'password123' })
          .expect(201)
      ).body,
    ).accessToken;
    organizationId = asSuccess<{ id: string }>(
      (
        await request(server)
          .post('/api/v1/organizations')
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({
            name: 'Salon Insights',
            type: 'services',
            country: 'CI',
            currency: 'XOF',
            timezone: 'Africa/Abidjan',
            language: 'fr',
          })
          .expect(201)
      ).body,
    ).id;

    // KORVA's money, written directly: one paid and one overdue plan invoice, a plan change
    // waiting for payment (never chased), and a sale credited to the Solde with its deductions.
    const org = new Types.ObjectId(organizationId);
    const now = Date.now();
    await connection.collection('subscription_invoices').insertMany([
      {
        organizationId: org,
        subscriptionId: new Types.ObjectId(),
        number: 'ABO-9001',
        amount: 9900,
        currency: 'XOF',
        status: 'paid',
        kind: 'renewal',
        paidAt: new Date(now - DAY_MS),
        dueAt: new Date(now - 2 * DAY_MS),
        periodStart: new Date(now - 3 * DAY_MS),
        periodEnd: new Date(now + 27 * DAY_MS),
      },
      {
        organizationId: org,
        subscriptionId: new Types.ObjectId(),
        number: 'ABO-9002',
        amount: 9900,
        currency: 'XOF',
        status: 'open',
        kind: 'renewal',
        dueAt: new Date(now - DAY_MS),
        periodStart: new Date(now),
        periodEnd: new Date(now + 30 * DAY_MS),
      },
      {
        organizationId: org,
        subscriptionId: new Types.ObjectId(),
        number: 'ABO-9003',
        amount: 29900,
        currency: 'XOF',
        status: 'open',
        kind: 'plan_change',
        dueAt: new Date(now - DAY_MS),
        periodStart: new Date(now),
        periodEnd: new Date(now + 30 * DAY_MS),
      },
    ]);
    await connection.collection('wallet_entries').insertMany([
      {
        organizationId: org,
        kind: 'sale',
        amount: 15000,
        currency: 'XOF',
        availableAt: new Date(now),
        sourceKey: 'ins:sale',
        createdAt: new Date(now),
      },
      {
        organizationId: org,
        kind: 'provider_fee',
        amount: -450,
        currency: 'XOF',
        availableAt: new Date(now),
        sourceKey: 'ins:fee',
        createdAt: new Date(now),
      },
      {
        organizationId: org,
        kind: 'commission',
        amount: -225,
        currency: 'XOF',
        availableAt: new Date(now),
        sourceKey: 'ins:com',
        createdAt: new Date(now),
      },
    ]);
  }, 120_000);

  afterAll(async () => {
    delete process.env.PLATFORM_ADMIN_EMAILS;
    await connection.dropDatabase();
    await app.close();
  });

  it('refuses a business user on every new route', async () => {
    for (const path of [
      'todo',
      'finance',
      'search?q=salon',
      'payment-accounts',
      `organizations/${organizationId}/notes`,
    ]) {
      await request(server)
        .get(`/api/v1/platform/${path}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(403);
    }
  });

  it('counts what waits for an action — an unpaid plan change is not overdue', async () => {
    const todo = asSuccess<Record<string, number>>(
      (await admin(request(server).get('/api/v1/platform/todo')).expect(200))
        .body,
    );
    expect(todo).toEqual({
      payoutsToApprove: 0,
      overdueInvoices: 1,
      reviewsToModerate: 0,
      pastDueSubscriptions: 0,
    });
  });

  it("shows KORVA's money: plans paid, sales, commissions and the invoices to chase", async () => {
    const finance = asSuccess<{
      plansPaid: { currency: string; total: number; count: number }[];
      onlineSales: { total: number; commissions: number; providerFees: number };
      held: { available: number };
      openInvoices: {
        number: string;
        overdue: boolean;
        organizationName: string;
      }[];
    }>(
      (
        await admin(
          request(server).get('/api/v1/platform/finance?days=30'),
        ).expect(200)
      ).body,
    );
    expect(finance.plansPaid).toEqual([
      { currency: 'XOF', total: 9900, count: 1 },
    ]);
    expect(finance.onlineSales).toMatchObject({
      total: 15000,
      commissions: 225,
      providerFees: 450,
    });
    expect(finance.held.available).toBe(14325);
    expect(finance.openInvoices).toEqual([
      expect.objectContaining({
        number: 'ABO-9002',
        overdue: true,
        organizationName: 'Salon Insights',
      }),
    ]);

    await admin(request(server).get('/api/v1/platform/finance?days=12')).expect(
      400,
    );
  });

  it('finds a business, a person and a plan invoice from one box', async () => {
    const results = asSuccess<{
      organizations: { name: string }[];
      users: { email: string }[];
      invoices: { number: string }[];
    }>(
      (
        await admin(
          request(server).get('/api/v1/platform/search?q=insights'),
        ).expect(200)
      ).body,
    );
    expect(results.organizations.map((o) => o.name)).toEqual([
      'Salon Insights',
    ]);
    expect(results.users.map((u) => u.email)).toEqual([
      'awa@salon-insights.ci',
    ]);

    const byNumber = asSuccess<{
      invoices: { number: string; organizationName: string }[];
    }>(
      (
        await admin(
          request(server).get('/api/v1/platform/search?q=ABO-9002'),
        ).expect(200)
      ).body,
    );
    expect(byNumber.invoices).toEqual([
      expect.objectContaining({
        number: 'ABO-9002',
        organizationName: 'Salon Insights',
      }),
    ]);

    // Regex characters are searched literally, and one letter returns nothing.
    const literal = asSuccess<{ organizations: unknown[] }>(
      (
        await admin(request(server).get('/api/v1/platform/search?q=.*')).expect(
          200,
        )
      ).body,
    );
    expect(literal.organizations).toEqual([]);
    const short = asSuccess<{ organizations: unknown[] }>(
      (
        await admin(request(server).get('/api/v1/platform/search?q=s')).expect(
          200,
        )
      ).body,
    );
    expect(short.organizations).toEqual([]);
  });

  it('keeps internal notes on a business, newest first, signed by the administrator', async () => {
    await admin(
      request(server).post(
        `/api/v1/platform/organizations/${organizationId}/notes`,
      ),
    )
      .send({ text: 'Appelée : veut son domaine.' })
      .expect(201);
    await admin(
      request(server).post(
        `/api/v1/platform/organizations/${organizationId}/notes`,
      ),
    )
      .send({ text: 'Domaine connecté.' })
      .expect(201);
    const notes = asSuccess<{ text: string; authorEmail: string }[]>(
      (
        await admin(
          request(server).get(
            `/api/v1/platform/organizations/${organizationId}/notes`,
          ),
        ).expect(200)
      ).body,
    );
    expect(notes.map((n) => n.text)).toEqual([
      'Domaine connecté.',
      'Appelée : veut son domaine.',
    ]);
    expect(notes[0]?.authorEmail).toBe('insights@korva.test');

    await admin(
      request(server).post(
        `/api/v1/platform/organizations/${organizationId}/notes`,
      ),
    )
      .send({ text: '   ' })
      .expect(400);
    await admin(
      request(server).post(
        `/api/v1/platform/organizations/${new Types.ObjectId().toString()}/notes`,
      ),
    )
      .send({ text: 'Personne' })
      .expect(404);
  });

  it('lists the payment accounts without any secret', async () => {
    const res = await admin(
      request(server).get('/api/v1/platform/payment-accounts'),
    ).expect(200);
    const body = asSuccess<{ payoutApproval: string; accounts: unknown[] }>(
      res.body,
    );
    expect(body.payoutApproval).toBe('manual');
    expect(JSON.stringify(res.body)).not.toMatch(/secret/i);
  });
});
