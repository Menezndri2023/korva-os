import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { SubscriptionsService } from '../src/subscriptions/subscriptions.service';

/**
 * The signup trial (SIGNUP_TRIAL in @korva/types): Pro for 14 days from onboarding, once, then
 * back to Free with every record kept. Standalone file, one registration.
 */

interface ApiSuccess<T> {
  success: true;
  data: T;
}
interface ApiError {
  success: false;
  error: { code: string; message: string; details?: Record<string, unknown> };
}
interface Summary {
  plan: { key: string };
  subscription: { trialEndsAt?: string | null; trialPlanKey?: string | null };
}
function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

describe('Signup trial (e2e)', () => {
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

  it('runs Pro for 14 days, once, then returns to Free keeping the data and settling the modules', async () => {
    const authRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email: 'trial-owner@korva.test', password: 'password123' })
      .expect(201);
    const accessToken = asSuccess<{ accessToken: string }>(
      authRes.body,
    ).accessToken;
    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Salon à l’essai',
        type: 'beauté',
        country: 'CI',
        currency: 'XOF',
        timezone: 'Africa/Abidjan',
        language: 'fr',
      })
      .expect(201);
    const organizationId = asSuccess<{ id: string }>(orgRes.body).id;
    const auth = (req: request.Test) =>
      req
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId);
    const summary = async () =>
      asSuccess<Summary>(
        (
          await auth(request(server).get('/api/v1/subscriptions/me')).expect(
            200,
          )
        ).body,
      );
    const workflow = (name: string) =>
      auth(request(server).post('/api/v1/workflows')).send({
        name,
        trigger: 'booking.created',
        actions: [
          { type: 'internal_notification', config: { title: 't', body: 'b' } },
        ],
      });

    expect((await summary()).plan.key).toBe('free');

    // Start: the trial plan becomes the active one, for 14 days.
    await auth(request(server).post('/api/v1/subscriptions/trial')).expect(201);
    const during = await summary();
    expect(during.plan.key).toBe('pro');
    const days =
      (new Date(during.subscription.trialEndsAt!).getTime() - Date.now()) /
      86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);

    // Pro features and quotas apply: both channels, the AI module, more than one automation.
    await auth(request(server).patch('/api/v1/organizations/me'))
      .send({
        enabledModules: [
          'catalog',
          'booking',
          'commerce',
          'marketing',
          'workflow',
          'website',
        ],
      })
      .expect(200);
    await workflow('Un').expect(201);
    await workflow('Deux').expect(201);

    // Only once.
    const again = await auth(
      request(server).post('/api/v1/subscriptions/trial'),
    ).expect(409);
    expect(asError(again.body).code).toBe('TRIAL_ALREADY_USED');

    // End: as soon as the date passes, Free applies again — no sweep needed for that.
    await connection
      .collection('subscriptions')
      .updateOne(
        { organizationId: new Types.ObjectId(organizationId) },
        { $set: { trialEndsAt: new Date(Date.now() - 1000) } },
      );
    expect((await summary()).plan.key).toBe('free');
    const refused = await workflow('Trois').expect(403);
    expect(asError(refused.body).code).toBe('PLAN_LIMIT_REACHED');

    // The sweep then switches off what Free does not include, keeping the salon's channel.
    await app.get(SubscriptionsService).settleExpiredTrials();
    const organization = await connection
      .collection('organizations')
      .findOne({ _id: new Types.ObjectId(organizationId) });
    expect(organization?.enabledModules).toEqual(
      expect.arrayContaining(['catalog', 'booking', 'workflow', 'website']),
    );
    // A paid module (marketing, Starter) is settled away; KORVA IA is on every plan since
    // 2026-10-23 and would stay.
    expect(organization?.enabledModules).not.toContain('marketing');
    expect(organization?.enabledModules).not.toContain('commerce');

    // Nothing created during the trial was deleted.
    const workflows = await auth(
      request(server).get('/api/v1/workflows'),
    ).expect(200);
    expect(asSuccess<unknown[]>(workflows.body)).toHaveLength(2);
  });
});
