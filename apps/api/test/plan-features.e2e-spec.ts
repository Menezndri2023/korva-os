import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { putOrganizationOnPlan } from './support/plan-tier';

/**
 * Paid-plan features of the V3 grid (PLAN_FEATURE_MIN_PLAN in @korva/types/plan-tiers.ts): each
 * one refused on Free with PLAN_FEATURE_NOT_INCLUDED, allowed from its tier, and nothing created
 * under a higher plan taken away. Standalone file, few registrations.
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

describe('Plan features (e2e)', () => {
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

  async function freeOrganization(email: string, type: string) {
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
        name: `Features ${email}`,
        type,
        country: 'CI',
        currency: 'XOF',
        timezone: 'Africa/Abidjan',
        language: 'fr',
      })
      .expect(201);
    const organization = asSuccess<{
      id: string;
      slug: string;
      enabledModules: string[];
    }>(orgRes.body);
    const auth = (req: request.Test) =>
      req
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organization.id);
    return { organization, auth };
  }

  function expectFeatureRefused(body: unknown, feature: string) {
    expect(asError(body)).toMatchObject({
      code: 'PLAN_FEATURE_NOT_INCLUDED',
      details: { feature },
    });
  }

  it('gives a free shop one sales channel and refuses the second, while Starter allows both', async () => {
    const { organization, auth } = await freeOrganization(
      'features-channel@korva.test',
      'commerce',
    );
    expect(organization.enabledModules).toContain('commerce');
    expect(organization.enabledModules).not.toContain('booking');

    const refused = await auth(
      request(server).patch('/api/v1/organizations/me'),
    )
      .send({ enabledModules: ['catalog', 'commerce', 'booking', 'website'] })
      .expect(403);
    expectFeatureRefused(refused.body, 'both_channels');

    await putOrganizationOnPlan(connection, organization.id, 'starter');
    await auth(request(server).patch('/api/v1/organizations/me'))
      .send({ enabledModules: ['catalog', 'commerce', 'booking', 'website'] })
      .expect(200);

    // Back on Free, an organization that already has both keeps them when saving.
    await putOrganizationOnPlan(connection, organization.id, 'free');
    await auth(request(server).patch('/api/v1/organizations/me'))
      .send({
        enabledModules: ['catalog', 'commerce', 'booking', 'website', 'crm'],
      })
      .expect(200);
  });

  it('refuses new variants and a new promotion on Free, keeps them after a downgrade', async () => {
    const { organization, auth } = await freeOrganization(
      'features-offers@korva.test',
      'commerce',
    );
    const product = {
      type: 'product',
      name: 'Robe',
      status: 'active',
      pricing: { amount: 10000, currency: 'XOF' },
    };

    expectFeatureRefused(
      (
        await auth(request(server).post('/api/v1/offers'))
          .send({ ...product, variants: [{ name: 'M' }] })
          .expect(403)
      ).body,
      'offer_variants',
    );
    expectFeatureRefused(
      (
        await auth(request(server).post('/api/v1/offers'))
          .send({ ...product, compareAtPrice: 15000 })
          .expect(403)
      ).body,
      'compare_at_price',
    );

    await putOrganizationOnPlan(connection, organization.id, 'starter');
    const created = asSuccess<{ id: string; variants: { id: string }[] }>(
      (
        await auth(request(server).post('/api/v1/offers'))
          .send({
            ...product,
            variants: [{ name: 'M' }],
            compareAtPrice: 15000,
          })
          .expect(201)
      ).body,
    );

    await putOrganizationOnPlan(connection, organization.id, 'free');
    // Editing the offer with what it already has is fine...
    await auth(request(server).patch(`/api/v1/offers/${created.id}`))
      .send({
        name: 'Robe wax',
        compareAtPrice: 15000,
        variants: [{ id: created.variants[0]!.id, name: 'M (38)' }],
      })
      .expect(200);
    // ...adding a variant is not.
    expectFeatureRefused(
      (
        await auth(request(server).patch(`/api/v1/offers/${created.id}`))
          .send({
            variants: [
              { id: created.variants[0]!.id, name: 'M' },
              { name: 'L' },
            ],
          })
          .expect(403)
      ).body,
      'offer_variants',
    );
  });

  it('keeps the kitchen screen for Starter, warehouses and suppliers for Pro', async () => {
    const { organization, auth } = await freeOrganization(
      'features-ops@korva.test',
      'restauration',
    );

    expectFeatureRefused(
      (await auth(request(server).get('/api/v1/kitchen-tickets')).expect(403))
        .body,
      'kitchen_display',
    );

    await putOrganizationOnPlan(connection, organization.id, 'starter');
    await auth(request(server).get('/api/v1/kitchen-tickets')).expect(200);
    expectFeatureRefused(
      (
        await auth(request(server).post('/api/v1/warehouses'))
          .send({ name: 'Dépôt 2' })
          .expect(403)
      ).body,
      'warehouses',
    );
    expectFeatureRefused(
      (
        await auth(request(server).post('/api/v1/suppliers'))
          .send({ name: 'Grossiste' })
          .expect(403)
      ).body,
      'suppliers',
    );

    await putOrganizationOnPlan(connection, organization.id, 'pro');
    await auth(request(server).post('/api/v1/warehouses'))
      .send({ name: 'Dépôt 2' })
      .expect(201);
    await auth(request(server).post('/api/v1/suppliers'))
      .send({ name: 'Grossiste' })
      .expect(201);
  });

  it('shows the KORVA mention, closes new customer accounts and refuses online payment on Free', async () => {
    const { organization, auth } = await freeOrganization(
      'features-site@korva.test',
      'commerce',
    );

    const site = asSuccess<{
      poweredByKorva: boolean;
      customerAccountsEnabled: boolean;
    }>(
      (
        await request(server)
          .get(`/api/v1/public/${organization.slug}`)
          .expect(200)
      ).body,
    );
    expect(site).toMatchObject({
      poweredByKorva: true,
      customerAccountsEnabled: false,
    });

    expectFeatureRefused(
      (
        await request(server)
          .post(`/api/v1/public/${organization.slug}/account/register`)
          .send({
            email: 'client@test.ci',
            password: 'password123',
            firstName: 'Kofi',
          })
          .expect(403)
      ).body,
      'customer_accounts',
    );

    expectFeatureRefused(
      (
        await auth(request(server).patch('/api/v1/organizations/me'))
          .send({ acceptedPaymentMethods: ['cash', 'online'] })
          .expect(403)
      ).body,
      'online_payment',
    );

    await putOrganizationOnPlan(connection, organization.id, 'starter');
    const paid = asSuccess<{
      poweredByKorva: boolean;
      customerAccountsEnabled: boolean;
    }>(
      (
        await request(server)
          .get(`/api/v1/public/${organization.slug}`)
          .expect(200)
      ).body,
    );
    expect(paid).toMatchObject({
      poweredByKorva: false,
      customerAccountsEnabled: true,
    });
    await request(server)
      .post(`/api/v1/public/${organization.slug}/account/register`)
      .send({
        email: 'client@test.ci',
        password: 'password123',
        firstName: 'Kofi',
      })
      .expect(201);
    await auth(request(server).patch('/api/v1/organizations/me'))
      .send({ acceptedPaymentMethods: ['cash', 'online'] })
      .expect(200);
  });
});
