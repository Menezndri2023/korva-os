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
interface OrganizationPayload {
  id: string;
  slug: string;
  tagline?: string;
  aboutText?: string;
}
interface PublicOrganizationPayload {
  tagline?: string;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}

/**
 * Phase E2 (docs/KORVA_OS_V2_AUDIT.md §2.6): a genuinely new organization gets a real tagline/
 * aboutText auto-generated from the owner's own entered `businessDescription` at signup — not
 * the "scrape an external URL" flow, which stays a separate, optional step. Standalone file for
 * the same AUTH_THROTTLE-budget reason as the other new Phase E e2e files.
 */
describe('Website auto-generation at signup (Phase E2, e2e)', () => {
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

  it('POST /organizations with businessDescription seeds tagline (first sentence) and aboutText (verbatim)', async () => {
    const authRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email: 'autogen-owner@korva.test', password: 'password123' })
      .expect(201);
    const accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Auto Gen Org',
        type: 'beauté',
        country: 'FR',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        language: 'fr',
        businessDescription:
          'Nous proposons des coupes, colorations et soins capillaires bio. Ouvert du mardi au samedi.',
      })
      .expect(201);
    const organization = asSuccess<OrganizationPayload>(orgRes.body);

    expect(organization.tagline).toBe(
      'Nous proposons des coupes, colorations et soins capillaires bio.',
    );
    expect(organization.aboutText).toBe(
      'Nous proposons des coupes, colorations et soins capillaires bio. Ouvert du mardi au samedi.',
    );

    // Re-fetched via GET /organizations/me too, not just the create response.
    const meRes = await request(server)
      .get('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .expect(200);
    const me = asSuccess<OrganizationPayload>(meRes.body);
    expect(me.tagline).toBe(organization.tagline);
    expect(me.aboutText).toBe(organization.aboutText);

    // tagline isn't plan-gated (unlike aboutText/testimonials/etc), so it's visible on the
    // public page immediately even on the org's default free plan.
    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .send({ enabledModules: ['website'] })
      .expect(200);
    const publicRes = await request(server)
      .get(`/api/v1/public/${organization.slug}`)
      .expect(200);
    const publicOrg = asSuccess<PublicOrganizationPayload>(publicRes.body);
    expect(publicOrg.tagline).toBe(organization.tagline);
  });

  it('POST /organizations without businessDescription leaves tagline/aboutText unset — never fabricated', async () => {
    const authRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email: 'no-autogen-owner@korva.test', password: 'password123' })
      .expect(201);
    const accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'No Auto Gen Org',
        type: 'services',
        country: 'FR',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        language: 'fr',
      })
      .expect(201);
    const organization = asSuccess<OrganizationPayload>(orgRes.body);

    expect(organization.tagline).toBeUndefined();
    expect(organization.aboutText).toBeUndefined();
  });
});
