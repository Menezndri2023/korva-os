import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { putOrganizationOnPlan } from './support/plan-tier';

/**
 * The counted quotas of the V3 plan grid (COUNTED_METRICS in @korva/types/plan-tiers.ts):
 * offers, bookable_staff and workflows, on top of seats. Standalone file, three registrations.
 *
 * What it proves: each limit refuses the item past it with PLAN_LIMIT_REACHED, only what the
 * limit is about counts (archived offers, places, equipment do not), bringing an item back into
 * the count is checked too, a higher plan lifts the limit, and the usage summary reports it.
 */

interface ApiSuccess<T> {
  success: true;
  data: T;
}
interface ApiError {
  success: false;
  error: { code: string; message: string; details?: Record<string, unknown> };
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

describe('Plan limits (e2e)', () => {
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

  async function freeOrganization(email: string) {
    const authRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email, password: 'password123' })
      .expect(201);
    const accessToken = asSuccess<{ accessToken: string }>(
      authRes.body,
    ).accessToken;
    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: `Limits ${email}`,
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
    return { organizationId, auth };
  }

  it('caps a free catalogue at 30 offers, archived ones excluded, and checks un-archiving', async () => {
    const { auth } = await freeOrganization('limits-offers@korva.test');
    const create = (status = 'active') =>
      auth(request(server).post('/api/v1/offers')).send({
        type: 'product',
        name: 'Article',
        status,
        pricing: { amount: 1000, currency: 'XOF' },
      });

    const ids: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      ids.push(asSuccess<{ id: string }>((await create().expect(201)).body).id);
    }
    const refused = await create().expect(403);
    expect(asError(refused.body).code).toBe('PLAN_LIMIT_REACHED');
    expect(asError(refused.body).details).toMatchObject({
      metric: 'offers',
      limit: 30,
    });

    // An archived offer is outside the count, both when created and when archived.
    await create('archived').expect(201);
    await auth(request(server).patch(`/api/v1/offers/${ids[0]}`))
      .send({ status: 'archived' })
      .expect(200);
    await create().expect(201);

    // Back at 30: bringing the archived one back needs room it no longer has.
    const unarchive = await auth(
      request(server).patch(`/api/v1/offers/${ids[0]}`),
    )
      .send({ status: 'active' })
      .expect(403);
    expect(asError(unarchive.body).code).toBe('PLAN_LIMIT_REACHED');

    const usage = asSuccess<{
      usage: { metric: string; used: number; limit: number }[];
    }>(
      (await auth(request(server).get('/api/v1/subscriptions/me')).expect(200))
        .body,
    ).usage;
    expect(usage.find((item) => item.metric === 'offers')).toMatchObject({
      used: 30,
      limit: 30,
    });
  }, 120_000);

  it('caps free bookable staff at 3 people, never places, and lifts the limit on Starter', async () => {
    const { organizationId, auth } = await freeOrganization(
      'limits-staff@korva.test',
    );
    await auth(request(server).patch('/api/v1/organizations/me'))
      .send({ enabledModules: ['catalog', 'booking', 'website'] })
      .expect(200);
    const resource = (type: string, name: string) =>
      auth(request(server).post('/api/v1/resources')).send({ name, type });

    for (const name of ['Awa', 'Moussa', 'Fatou']) {
      await resource('person', name).expect(201);
    }
    const refused = await resource('person', 'Kofi').expect(403);
    expect(asError(refused.body).details).toMatchObject({
      metric: 'bookable_staff',
      limit: 3,
    });
    await resource('room', 'Cabine 1').expect(201);
    await resource('room', 'Cabine 2').expect(201);

    // A place turned into a person counts like a new person.
    const cabin = asSuccess<{ id: string }>(
      (await resource('room', 'Cabine 3').expect(201)).body,
    );
    await auth(request(server).patch(`/api/v1/resources/${cabin.id}`))
      .send({ type: 'person' })
      .expect(403);

    await putOrganizationOnPlan(connection, organizationId, 'starter');
    await resource('person', 'Kofi').expect(201);
  });

  it('allows one automation on Free and five on Starter', async () => {
    const { organizationId, auth } = await freeOrganization(
      'limits-workflows@korva.test',
    );
    const workflow = (name: string) =>
      auth(request(server).post('/api/v1/workflows')).send({
        name,
        trigger: 'booking.created',
        actions: [
          { type: 'internal_notification', config: { title: 't', body: 'b' } },
        ],
      });

    await workflow('Celle du métier').expect(201);
    const refused = await workflow('Une de trop').expect(403);
    expect(asError(refused.body).details).toMatchObject({
      metric: 'workflows',
      limit: 1,
    });

    await putOrganizationOnPlan(connection, organizationId, 'starter');
    for (let i = 2; i <= 5; i += 1) await workflow(`W${i}`).expect(201);
    await workflow('W6').expect(403);
  });

  it('names the extra-user price when the free seat is taken, and says it cannot be bought yet', async () => {
    const { organizationId, auth } = await freeOrganization(
      'limits-seats@korva.test',
    );
    const staffRole = await connection.collection('roles').findOne({
      organizationId: new Types.ObjectId(organizationId),
      systemKey: 'STAFF',
    });
    await request(server)
      .post('/api/v1/auth/register')
      .send({ email: 'limits-seat-2@korva.test', password: 'password123' })
      .expect(201);

    const refused = await auth(
      request(server).post('/api/v1/organizations/me/members'),
    )
      .send({
        email: 'limits-seat-2@korva.test',
        roleId: String(staffRole?._id),
      })
      .expect(403);
    expect(asError(refused.body)).toMatchObject({
      code: 'SEAT_LIMIT_REACHED',
      // The dashboard builds its French message from exactly these keys.
      details: {
        limit: 1,
        extraSeat: { price: 1500, currency: 'XOF', purchasable: false },
      },
    });
  });
});
