import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import {
  putOrganizationOnPlan,
  payPendingPlanChange,
} from './support/plan-tier';

/**
 * The website grows with the plan (2026-11-08): favourites (Pro), tracking ids (Pro) and the home
 * slideshow (Business). Its own file because public.e2e-spec.ts already registers as many
 * accounts as the sign-up rate limit allows in one app.
 */

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
  slug: string;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

describe('Website features by plan (e2e)', () => {
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

  async function setupStorefrontOrg(email: string, orgName: string) {
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
        type: 'services',
        country: 'FR',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        language: 'fr',
      })
      .expect(201);
    const organization = asSuccess<OrganizationPayload>(orgRes.body);
    await putOrganizationOnPlan(connection, organization.id, 'starter');
    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .send({ enabledModules: ['catalog', 'commerce', 'crm', 'website'] })
      .expect(200);
    return {
      accessToken,
      organizationId: organization.id,
      slug: organization.slug,
    };
  }

  describe('tracking (Pro) and home slideshow (Business)', () => {
    async function onPlan(
      email: string,
      name: string,
      planKey: 'starter' | 'pro' | 'business',
    ) {
      const org = await setupStorefrontOrg(email, name);
      await putOrganizationOnPlan(connection, org.organizationId, planKey);
      return org;
    }
    function patch(
      org: { accessToken: string; organizationId: string },
      body: object,
    ) {
      return request(server)
        .patch('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${org.accessToken}`)
        .set('X-Organization-Id', org.organizationId)
        .send(body);
    }

    it('refuses tracking ids below Pro and the slideshow below Business', async () => {
      const starter = await onPlan(
        'tracking-starter@korva.test',
        'Tracking Starter Org',
        'starter',
      );
      const tracking = await patch(starter, {
        googleAnalyticsId: 'G-ABC123XYZ',
      });
      expect(tracking.status).toBe(403);
      expect(asError(tracking.body).code).toBe('PLAN_FEATURE_NOT_INCLUDED');

      const pro = await onPlan(
        'slides-pro@korva.test',
        'Slides Pro Org',
        'pro',
      );
      const slides = await patch(pro, {
        heroSlides: ['https://cdn.korva.test/2.jpg'],
      });
      expect(slides.status).toBe(403);
      expect(asError(slides.body).code).toBe('PLAN_FEATURE_NOT_INCLUDED');
    });

    it('rejects an id that is not a Google Analytics or Meta Pixel id', async () => {
      const pro = await onPlan(
        'tracking-bad@korva.test',
        'Tracking Bad Org',
        'pro',
      );
      await patch(pro, { googleAnalyticsId: 'UA-1234-1' }).expect(400);
      await patch(pro, { metaPixelId: 'abc' }).expect(400);
    });

    it('sends a Business site its tracking ids and its slideshow, and stops once downgraded', async () => {
      const business = await onPlan(
        'slides-business@korva.test',
        'Slides Business Org',
        'business',
      );
      await patch(business, {
        googleAnalyticsId: 'g-abc123xyz',
        metaPixelId: '123456789012345',
        heroSlides: [
          'https://cdn.korva.test/2.jpg',
          'https://cdn.korva.test/3.jpg',
        ],
      }).expect(200);

      const onBusiness = asSuccess<{
        tracking?: { googleAnalyticsId?: string; metaPixelId?: string };
        heroSlides?: string[];
      }>(
        (
          await request(server)
            .get(`/api/v1/public/${business.slug}`)
            .expect(200)
        ).body,
      );
      expect(onBusiness.tracking).toEqual({
        googleAnalyticsId: 'G-ABC123XYZ',
        metaPixelId: '123456789012345',
      });
      expect(onBusiness.heroSlides).toHaveLength(2);

      await putOrganizationOnPlan(
        connection,
        business.organizationId,
        'starter',
      );
      const onStarter = asSuccess<{ tracking?: unknown; heroSlides?: unknown }>(
        (
          await request(server)
            .get(`/api/v1/public/${business.slug}`)
            .expect(200)
        ).body,
      );
      expect(onStarter.tracking).toBeUndefined();
      expect(onStarter.heroSlides).toBeUndefined();
    });
  });

  describe('featured offers (« coups de cœur »)', () => {
    async function createOffer(
      accessToken: string,
      organizationId: string,
      name: string,
      featured?: boolean,
    ) {
      return request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'product',
          name,
          status: 'active',
          pricing: { amount: 10, currency: 'EUR' },
          ...(featured !== undefined ? { featured } : {}),
        });
    }

    it('refuses marking a favourite below Pro', async () => {
      const { accessToken, organizationId } = await setupStorefrontOrg(
        'featured-free@korva.test',
        'Featured Free Org',
      );
      const res = await createOffer(accessToken, organizationId, 'Pagne', true);
      expect(res.status).toBe(403);
      expect(asError(res.body).code).toBe('PLAN_FEATURE_NOT_INCLUDED');
    });

    it('puts a Pro business favourites first on its site, marked, and stops after a downgrade', async () => {
      const { accessToken, organizationId, slug } = await setupStorefrontOrg(
        'featured-pro@korva.test',
        'Featured Pro Org',
      );
      await request(server)
        .post('/api/v1/subscriptions/change-plan')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ planKey: 'pro' })
        .expect(201);
      await payPendingPlanChange(app, organizationId);

      await createOffer(accessToken, organizationId, 'Favori', true).then((r) =>
        expect(r.status).toBe(201),
      );
      await createOffer(accessToken, organizationId, 'Récent').then((r) =>
        expect(r.status).toBe(201),
      );

      const onPro = await request(server)
        .get(`/api/v1/public/${slug}/offers`)
        .expect(200);
      const offers = asSuccess<{ name: string; featured?: boolean }[]>(
        onPro.body,
      );
      expect(offers[0]).toMatchObject({ name: 'Favori', featured: true });
      expect(offers.find((o) => o.name === 'Récent')?.featured).toBeUndefined();

      await request(server)
        .post('/api/v1/subscriptions/change-plan')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ planKey: 'free' })
        .expect(201);
      const onFree = await request(server)
        .get(`/api/v1/public/${slug}/offers`)
        .expect(200);
      const freeOffers = asSuccess<{ name: string; featured?: boolean }[]>(
        onFree.body,
      );
      expect(freeOffers.every((o) => o.featured === undefined)).toBe(true);
    });
  });
});
