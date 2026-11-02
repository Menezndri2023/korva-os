import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { REFERRAL_REWARD, SIGNUP_TRIAL } from '@korva/types';
import { AppModule } from './../src/app.module';
import { SubscriptionBillingService } from './../src/subscription-billing/subscription-billing.service';

interface ApiSuccess<T> {
  success: true;
  data: T;
}
function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Parrainage and "Comment avez-vous connu KORVA ?": a business shares its code, the business that
 * signs up with it gets the longer trial and is recorded as referred, and the referring business
 * gets its month of Pro only once the referred one pays — once, however often the payment is
 * replayed. Own file for the register-throttle budget.
 */
describe('Referrals (e2e)', () => {
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

  async function signUp(email: string, extra: Record<string, unknown> = {}) {
    const auth = await request(server)
      .post('/api/v1/auth/register')
      .send({ email, password: 'password123' })
      .expect(201);
    const token = asSuccess<{ accessToken: string }>(auth.body).accessToken;
    const org = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: email.split('@')[0],
        type: 'commerce',
        country: 'CI',
        currency: 'XOF',
        timezone: 'Africa/Abidjan',
        language: 'fr',
        ...extra,
      })
      .expect(201);
    const organizationId = asSuccess<{ id: string }>(org.body).id;
    const as = (req: request.Test) =>
      req
        .set('Authorization', `Bearer ${token}`)
        .set('X-Organization-Id', organizationId);
    return { organizationId, as };
  }

  const organization = (id: string) =>
    connection
      .collection('organizations')
      .findOne({ _id: new Types.ObjectId(id) });
  const subscription = (id: string) =>
    connection
      .collection('subscriptions')
      .findOne({ organizationId: new Types.ObjectId(id) });

  it('records how a business heard of KORVA', async () => {
    const shop = await signUp('heard@korva.test', {
      acquisitionSource: 'tiktok',
    });
    expect((await organization(shop.organizationId))?.acquisitionSource).toBe(
      'tiktok',
    );
  });

  it('rewards the referring business once, when the referred one pays its first invoice', async () => {
    const referrer = await signUp('parrain@korva.test');
    const summary = await referrer
      .as(request(server).get('/api/v1/organizations/me/referral'))
      .expect(200);
    const { code } = asSuccess<{ code: string }>(summary.body);
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    // The same code every time it is asked for.
    const again = await referrer
      .as(request(server).get('/api/v1/organizations/me/referral'))
      .expect(200);
    expect(asSuccess<{ code: string }>(again.body).code).toBe(code);

    // An unknown code never blocks a signup.
    const stranger = await signUp('inconnu@korva.test', {
      referralCode: 'NOPE99',
    });
    expect(
      (await organization(stranger.organizationId))?.referredByOrganizationId,
    ).toBeUndefined();

    const referred = await signUp('filleul@korva.test', {
      referralCode: code.toLowerCase(),
    });
    const referredDoc = await organization(referred.organizationId);
    expect(
      (
        referredDoc?.referredByOrganizationId as Types.ObjectId | undefined
      )?.toString(),
    ).toBe(referrer.organizationId);
    expect(referredDoc?.acquisitionSource).toBe('referral');

    // The referred business's trial is the longer one.
    await referred
      .as(request(server).post('/api/v1/subscriptions/trial'))
      .expect(201);
    const trialDays =
      ((
        (await subscription(referred.organizationId))!.trialEndsAt as Date
      ).getTime() -
        Date.now()) /
      DAY_MS;
    expect(Math.round(trialDays)).toBe(REFERRAL_REWARD.refereeTrialDays);
    expect(REFERRAL_REWARD.refereeTrialDays).toBeGreaterThan(SIGNUP_TRIAL.days);

    // Signing up alone earns the referrer nothing.
    expect(
      (await subscription(referrer.organizationId))?.trialEndsAt,
    ).toBeFalsy();
    let counts = asSuccess<{ signedUp: number; rewarded: number }>(
      (
        await referrer
          .as(request(server).get('/api/v1/organizations/me/referral'))
          .expect(200)
      ).body,
    );
    expect(counts).toMatchObject({ signedUp: 1, rewarded: 0 });

    // The referred business pays a KORVA invoice: the referrer gets its month of Pro.
    const referredSubscription = await subscription(referred.organizationId);
    const now = new Date();
    const inserted = await connection
      .collection('subscription_invoices')
      .insertOne({
        organizationId: new Types.ObjectId(referred.organizationId),
        subscriptionId: referredSubscription!._id,
        planId: referredSubscription!.planId,
        number: 'ABO-REF-1',
        status: 'open',
        periodStart: now,
        periodEnd: new Date(now.getTime() + 30 * DAY_MS),
        amount: 9900,
        currency: 'XOF',
        issuedAt: now,
        dueAt: now,
        paidAt: null,
        createdAt: now,
        updatedAt: now,
      });
    const billing = app.get(SubscriptionBillingService);
    await billing.settleAsPaid(
      referred.organizationId,
      inserted.insertedId.toString(),
      'ABO-REF-1',
      { test: true },
    );
    const rewardedUntil = (await subscription(referrer.organizationId))!
      .trialEndsAt as Date;
    expect(Math.round((rewardedUntil.getTime() - Date.now()) / DAY_MS)).toBe(
      REFERRAL_REWARD.referrerProDays,
    );

    // A second payment rewards nothing more.
    const second = await connection
      .collection('subscription_invoices')
      .insertOne({
        organizationId: new Types.ObjectId(referred.organizationId),
        subscriptionId: referredSubscription!._id,
        planId: referredSubscription!.planId,
        number: 'ABO-REF-2',
        status: 'open',
        periodStart: new Date(now.getTime() + 30 * DAY_MS),
        periodEnd: new Date(now.getTime() + 60 * DAY_MS),
        amount: 9900,
        currency: 'XOF',
        issuedAt: now,
        dueAt: now,
        paidAt: null,
        createdAt: now,
        updatedAt: now,
      });
    await billing.settleAsPaid(
      referred.organizationId,
      second.insertedId.toString(),
      'ABO-REF-2',
      { test: true },
    );
    expect(
      (
        (await subscription(referrer.organizationId))!.trialEndsAt as Date
      ).getTime(),
    ).toBe(rewardedUntil.getTime());

    counts = asSuccess<{ signedUp: number; rewarded: number }>(
      (
        await referrer
          .as(request(server).get('/api/v1/organizations/me/referral'))
          .expect(200)
      ).body,
    );
    expect(counts).toMatchObject({ signedUp: 1, rewarded: 1 });
  });
});
