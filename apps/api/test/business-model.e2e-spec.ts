import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { migration as businessModelBackfill } from '../src/migrations/0005-business-model-backfill';

/**
 * Organization.businessModel — the stored type of activity (docs/KORVA_OS_V3_STRUCTURE_PRODUIT.md
 * §2). Standalone file: it registers its own owners and must not eat another file's
 * AUTH_THROTTLE budget.
 */

interface ApiSuccess<T> {
  success: true;
  data: T;
}
interface OrganizationPayload {
  id: string;
  slug: string;
  type: string;
  businessModel?: string;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}

describe('Organization business model (e2e)', () => {
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

  async function createOrganization(
    email: string,
    body: Record<string, unknown>,
  ): Promise<{ accessToken: string; organization: OrganizationPayload }> {
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
        country: 'FR',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        language: 'fr',
        ...body,
      })
      .expect(201);
    return {
      accessToken,
      organization: asSuccess<OrganizationPayload>(orgRes.body),
    };
  }

  it('derives the type of activity from a recognised trade, keeps an explicit one, and leaves an unknown trade without one', async () => {
    const derived = await createOrganization('bm-derived@korva.test', {
      name: 'Salon Awa',
      type: 'beauté',
    });
    expect(derived.organization.businessModel).toBe('appointments');

    // An explicit choice wins over the trade.
    const explicit = await createOrganization('bm-explicit@korva.test', {
      name: 'Traiteur Fatou',
      type: 'beauté',
      businessModel: 'restaurant',
    });
    expect(explicit.organization.businessModel).toBe('restaurant');

    const unknown = await createOrganization('bm-unknown@korva.test', {
      name: 'Atelier X',
      type: 'quelque chose de nouveau',
    });
    expect(unknown.organization.businessModel).toBeUndefined();

    // The owner can set it afterwards, and the public site then uses that activity's template
    // instead of the generic one.
    const patched = await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${unknown.accessToken}`)
      .set('X-Organization-Id', unknown.organization.id)
      .send({ businessModel: 'training' })
      .expect(200);
    expect(asSuccess<OrganizationPayload>(patched.body).businessModel).toBe(
      'training',
    );

    const site = await request(server)
      .get(`/api/v1/public/${unknown.organization.slug}`)
      .expect(200);
    expect(
      asSuccess<{ storefrontTheme: { template: string } }>(site.body)
        .storefrontTheme.template,
    ).toBe('academie');
  });

  it('rejects a value outside the eight types of activity', async () => {
    const { accessToken, organization } = await createOrganization(
      'bm-invalid@korva.test',
      { name: 'Invalide', type: 'commerce' },
    );
    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .send({ businessModel: 'garage' })
      .expect(400);
  });

  it('backfills existing organizations from their trade, never overwriting and never guessing', async () => {
    const organizations = connection.collection('organizations');
    const now = new Date();
    const base = {
      country: 'FR',
      currency: 'EUR',
      timezone: 'Europe/Paris',
      language: 'fr',
      enabledModules: [],
      createdAt: now,
      updatedAt: now,
    };
    const shop = new Types.ObjectId();
    const chosen = new Types.ObjectId();
    const unknown = new Types.ObjectId();
    await organizations.insertMany([
      {
        _id: shop,
        ...base,
        name: 'Freeworld',
        slug: 'bm-freeworld',
        type: 'commerce',
      },
      {
        _id: chosen,
        ...base,
        name: 'Choisi',
        slug: 'bm-chosen',
        type: 'commerce',
        businessModel: 'association',
      },
      {
        _id: unknown,
        ...base,
        name: 'Inconnu',
        slug: 'bm-unknown',
        type: 'divers',
      },
    ]);

    await businessModelBackfill.up(connection);
    // Running again converges to the same state.
    await businessModelBackfill.up(connection);

    const read = async (id: Types.ObjectId) =>
      (await organizations.findOne({ _id: id }))?.businessModel as
        string | undefined;
    expect(await read(shop)).toBe('retail');
    expect(await read(chosen)).toBe('association');
    expect(await read(unknown)).toBeUndefined();
  });
});
