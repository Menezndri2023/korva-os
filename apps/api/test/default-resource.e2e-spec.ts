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

interface AuthPayload {
  accessToken: string;
}
interface ResourcePayload {
  id: string;
  name: string;
  type: string;
  weeklyAvailability: {
    dayOfWeek: number;
    startTime: string;
    endTime: string;
  }[];
}
interface OrganizationPayload {
  id: string;
  slug: string;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}

/**
 * A business with booking switched on but nobody set up yet used to show a "Réserver" button
 * leading to an empty choice: no booking could ever be made. It now gets one bookable resource,
 * named after it, open Monday–Saturday 9:00–18:00. Own file for the register-throttle budget.
 */
describe('Default bookable resource (e2e)', () => {
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

  async function setupOrg(email: string, name: string, modules: string[]) {
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
        country: 'FR',
        currency: 'EUR',
        timezone: 'Europe/Paris',
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

  it('a new business with booking on can be booked right away, with one default resource', async () => {
    const { slug } = await setupOrg(
      'default-resource@korva.test',
      'Salon Neuf',
      ['booking', 'website', 'catalog'],
    );

    // Two first visitors at the same time still produce a single resource.
    const [first, second] = await Promise.all([
      request(server).get(`/api/v1/public/${slug}/resources`).expect(200),
      request(server).get(`/api/v1/public/${slug}/resources`).expect(200),
    ]);
    const resources = asSuccess<ResourcePayload[]>(first.body);
    expect(asSuccess<ResourcePayload[]>(second.body)).toHaveLength(1);
    expect(resources).toHaveLength(1);
    expect(resources[0]).toMatchObject({ name: 'Salon Neuf', type: 'person' });
    // Monday to Saturday, 9:00–18:00 — never round the clock.
    expect(resources[0]!.weeklyAvailability.map((w) => w.dayOfWeek)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(resources[0]!.weeklyAvailability[0]).toMatchObject({
      startTime: '09:00',
      endTime: '18:00',
    });

    const again = asSuccess<ResourcePayload[]>(
      (
        await request(server)
          .get(`/api/v1/public/${slug}/resources`)
          .expect(200)
      ).body,
    );
    expect(again.map((r) => r.id)).toEqual([resources[0]!.id]);
  });

  it('adds nothing to a business that already set up its own resources', async () => {
    const { accessToken, organizationId, slug } = await setupOrg(
      'own-resource@korva.test',
      'Salon Equipe',
      ['booking', 'website', 'catalog'],
    );
    await request(server)
      .post('/api/v1/resources')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ name: 'Aminata', type: 'person', capacity: 1 })
      .expect(201);

    const resources = asSuccess<ResourcePayload[]>(
      (
        await request(server)
          .get(`/api/v1/public/${slug}/resources`)
          .expect(200)
      ).body,
    );
    expect(resources.map((r) => r.name)).toEqual(['Aminata']);
  });
});
