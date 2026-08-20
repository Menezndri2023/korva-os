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
interface OfferVariantPayload {
  id: string;
  name: string;
}
interface OfferPayload {
  id: string;
  type: string;
  status: string;
  variants: OfferVariantPayload[];
  customFields: Record<string, unknown>;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

describe('Catalog module (e2e)', () => {
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
        type: 'commerce',
        country: 'FR',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        language: 'fr',
      })
      .expect(201);
    const organizationId = asSuccess<OrganizationPayload>(orgRes.body).id;

    return { accessToken, organizationId };
  }

  describe('offers CRUD, variants and custom fields', () => {
    let accessToken: string;
    let organizationId: string;
    let offerId: string;

    beforeAll(async () => {
      ({ accessToken, organizationId } = await registerOrgAndToken(
        'catalog-owner@korva.test',
        'Catalog Org',
      ));
      await request(server)
        .post('/api/v1/custom-fields')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          entity: 'offers',
          key: 'material',
          label: 'Material',
          type: 'text',
        })
        .expect(201);
    });

    it('rejects an offer with an unknown custom field', async () => {
      const res = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'product',
          name: 'Bad',
          pricing: { amount: 1, currency: 'EUR' },
          customFields: { nope: 1 },
        })
        .expect(400);
      expect(asError(res.body).code).toBe('UNKNOWN_CUSTOM_FIELD');
    });

    it('creates a product offer with variants and a custom field, assigning ids to each variant', async () => {
      const res = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'product',
          name: 'T-Shirt',
          categories: ['clothing'],
          pricing: { amount: 19.99, currency: 'EUR', taxRate: 20 },
          sku: 'TSHIRT-01',
          status: 'active',
          variants: [{ name: 'S' }, { name: 'M' }],
          customFields: { material: 'cotton' },
        })
        .expect(201);
      const offer = asSuccess<OfferPayload>(res.body);
      offerId = offer.id;
      expect(offer.variants).toHaveLength(2);
      expect(offer.variants[0]?.id).toBeTruthy();
      expect(offer.customFields.material).toBe('cotton');
    });

    it('filters offers by type', async () => {
      await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'service',
          name: 'Consulting',
          pricing: { amount: 50, currency: 'EUR' },
        })
        .expect(201);

      const res = await request(server)
        .get('/api/v1/offers?type=service')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const offers = asSuccess<OfferPayload[]>(res.body);
      expect(offers.every((o) => o.type === 'service')).toBe(true);
    });

    it('finds the offer by full-text search on its name', async () => {
      const res = await request(server)
        .get('/api/v1/offers?search=T-Shirt')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const offers = asSuccess<OfferPayload[]>(res.body);
      expect(offers.map((o) => o.id)).toContain(offerId);
    });

    it('updates the offer status and then deletes it', async () => {
      const updateRes = await request(server)
        .patch(`/api/v1/offers/${offerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ status: 'archived' })
        .expect(200);
      expect(asSuccess<OfferPayload>(updateRes.body).status).toBe('archived');

      await request(server)
        .delete(`/api/v1/offers/${offerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);

      await request(server)
        .get(`/api/v1/offers/${offerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(404);
    });
  });

  describe('tenant isolation for offers', () => {
    it('denies a user from another organization reading offers via a foreign org id', async () => {
      const a = await registerOrgAndToken(
        'catalog-iso-a@korva.test',
        'Catalog Iso A',
      );
      const b = await registerOrgAndToken(
        'catalog-iso-b@korva.test',
        'Catalog Iso B',
      );

      await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Organization-Id', a.organizationId)
        .send({
          type: 'product',
          name: 'Secret Product',
          pricing: { amount: 1, currency: 'EUR' },
        })
        .expect(201);

      const res = await request(server)
        .get('/api/v1/offers')
        .set('Authorization', `Bearer ${b.accessToken}`)
        .set('X-Organization-Id', a.organizationId)
        .expect(403);
      expect(asError(res.body).code).toBe('ORGANIZATION_ACCESS_DENIED');

      const ownRes = await request(server)
        .get('/api/v1/offers')
        .set('Authorization', `Bearer ${b.accessToken}`)
        .set('X-Organization-Id', b.organizationId)
        .expect(200);
      expect(asSuccess<OfferPayload[]>(ownRes.body)).toHaveLength(0);
    });
  });
});
