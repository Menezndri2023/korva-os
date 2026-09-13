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
}
interface PublicOrganizationPayload {
  name: string;
  seoTitle?: string;
  seoDescription?: string;
}
interface SitemapEntryPayload {
  slug: string;
  updatedAt: string;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}

/**
 * Phase E4 (docs/KORVA_OS_V2_AUDIT.md §2.6): SEO title/description overrides surface through
 * GET /public/:slug, and GET /public-sites/sitemap-entries enumerates only website-enabled
 * tenant slugs — the real backend contract sitemap.ts needed and didn't have before. Standalone
 * file for the same AUTH_THROTTLE-budget reason as the other new Phase E e2e files.
 */
describe('Website SEO overrides and sitemap entries (Phase E4, e2e)', () => {
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

  it('an org-configured seoTitle/seoDescription overrides the auto-derived public metadata', async () => {
    const { accessToken, organizationId, slug } = await setupOrg(
      'seo-owner@korva.test',
      'SEO Org',
      ['website'],
    );

    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        seoTitle: 'Bienvenue chez SEO Org — Paris',
        seoDescription: 'Le meilleur salon de coiffure du 11e arrondissement.',
      })
      .expect(200);

    const pageRes = await request(server)
      .get(`/api/v1/public/${slug}`)
      .expect(200);
    const page = asSuccess<PublicOrganizationPayload>(pageRes.body);

    expect(page.seoTitle).toBe('Bienvenue chez SEO Org — Paris');
    expect(page.seoDescription).toBe(
      'Le meilleur salon de coiffure du 11e arrondissement.',
    );
  });

  it('GET /public/:slug omits seoTitle/seoDescription when never configured', async () => {
    const { slug } = await setupOrg('no-seo-owner@korva.test', 'No SEO Org', [
      'website',
    ]);

    const pageRes = await request(server)
      .get(`/api/v1/public/${slug}`)
      .expect(200);
    const page = asSuccess<PublicOrganizationPayload>(pageRes.body);

    expect(page.seoTitle).toBeUndefined();
    expect(page.seoDescription).toBeUndefined();
  });

  it('GET /public-sites/sitemap-entries lists only website-enabled orgs, never one with website off', async () => {
    const { slug: websiteOnSlug } = await setupOrg(
      'sitemap-on-owner@korva.test',
      'Sitemap On Org',
      ['website', 'catalog'],
    );
    const { slug: websiteOffSlug } = await setupOrg(
      'sitemap-off-owner@korva.test',
      'Sitemap Off Org',
      ['catalog'],
    );

    const res = await request(server)
      .get('/api/v1/public-sites/sitemap-entries')
      .expect(200);
    const entries = asSuccess<SitemapEntryPayload[]>(res.body);
    const slugs = entries.map((entry) => entry.slug);

    expect(slugs).toContain(websiteOnSlug);
    expect(slugs).not.toContain(websiteOffSlug);
    // Every listed entry carries a real, parseable timestamp for sitemap.ts's lastModified.
    for (const entry of entries) {
      expect(Number.isNaN(new Date(entry.updatedAt).getTime())).toBe(false);
    }
  });
});
