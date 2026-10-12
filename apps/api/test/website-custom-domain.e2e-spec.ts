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
  slug: string;
  customDomain?: string;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

/**
 * Phase E3 (docs/KORVA_OS_V2_AUDIT.md §2.6) v1 custom domain: uniqueness enforcement and the
 * `GET /public-sites/resolve-domain` endpoint apps/storefront's middleware calls. Standalone
 * file for the same AUTH_THROTTLE-budget reason as the other new Phase E e2e files.
 */
describe('Website custom domain (Phase E3, e2e)', () => {
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

  it('rejects a customDomain that is not a bare hostname (scheme/path included)', async () => {
    const { accessToken, organizationId } = await setupOrg(
      'domain-invalid-owner@korva.test',
      'Domain Invalid Org',
      ['website'],
    );

    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ customDomain: 'https://www.example.com/path' })
      .expect(400);
  });

  it('accepts a valid bare hostname and rejects a second org claiming the same one', async () => {
    const first = await setupOrg(
      'domain-first-owner@korva.test',
      'Domain First Org',
      ['website'],
    );
    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${first.accessToken}`)
      .set('X-Organization-Id', first.organizationId)
      .send({ customDomain: 'www.shared-domain-test.com' })
      .expect(200);

    const second = await setupOrg(
      'domain-second-owner@korva.test',
      'Domain Second Org',
      ['website'],
    );
    const conflictRes = await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${second.accessToken}`)
      .set('X-Organization-Id', second.organizationId)
      .send({ customDomain: 'www.shared-domain-test.com' })
      .expect(409);
    expect(asError(conflictRes.body).code).toBe('CUSTOM_DOMAIN_TAKEN');
  });

  it('GET /public-sites/resolve-domain resolves a connected domain to its slug', async () => {
    const { accessToken, organizationId, slug } = await setupOrg(
      'domain-resolve-owner@korva.test',
      'Domain Resolve Org',
      ['website'],
    );
    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ customDomain: 'www.resolve-test.com' })
      .expect(200);

    const res = await request(server)
      .get('/api/v1/public-sites/resolve-domain')
      .query({ host: 'www.resolve-test.com' })
      .expect(200);
    expect(asSuccess<{ slug: string }>(res.body).slug).toBe(slug);
  });

  it('GET /public-sites/resolve-domain 404s for an unknown domain', async () => {
    const res = await request(server)
      .get('/api/v1/public-sites/resolve-domain')
      .query({ host: 'nobody-owns-this-domain.example.com' })
      .expect(404);
    expect(asError(res.body).code).toBe('CUSTOM_DOMAIN_NOT_FOUND');
  });

  it('GET /public-sites/resolve-domain 404s for a domain whose org has website disabled — a custom domain obeys the same product gate as the shared URL', async () => {
    const { accessToken, organizationId } = await setupOrg(
      'domain-website-off-owner@korva.test',
      'Domain Website Off Org',
      ['website'],
    );
    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ customDomain: 'www.website-off-test.com' })
      .expect(200);
    // Now disable website while keeping the domain connected.
    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ enabledModules: ['catalog'] })
      .expect(200);

    const res = await request(server)
      .get('/api/v1/public-sites/resolve-domain')
      .query({ host: 'www.website-off-test.com' })
      .expect(404);
    expect(asError(res.body).code).toBe('CUSTOM_DOMAIN_NOT_FOUND');
  });

  /**
   * GET /public-sites/domain-allowed — the `ask` endpoint for Caddy's on-demand TLS (see
   * docker/caddy/Caddyfile). Caddy reads the STATUS CODE only, so these tests assert the status
   * and the absence of a body rather than a payload shape.
   */
  describe('domain-allowed (on-demand TLS authorization)', () => {
    it('204s with an empty body for a domain connected to a website-enabled organization', async () => {
      const { accessToken, organizationId } = await setupOrg(
        'domain-allowed-owner@korva.test',
        'Domain Allowed Org',
        ['website'],
      );
      await request(server)
        .patch('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ customDomain: 'www.allowed-test.com' })
        .expect(200);

      const res = await request(server)
        .get('/api/v1/public-sites/domain-allowed')
        .query({ domain: 'www.allowed-test.com' })
        .expect(204);
      // No body at all: this route is unauthenticated, and naming the organization that owns a
      // domain would tell an unapproved caller more than Caddy needs to know.
      expect(res.text).toBe('');
      expect(res.body).toEqual({});
    });

    it('404s for a domain nobody has connected, so Caddy never requests a certificate for it', async () => {
      await request(server)
        .get('/api/v1/public-sites/domain-allowed')
        .query({ domain: 'attacker-pointed-this-here.example.com' })
        .expect(404);
    });

    it('404s for a connected domain whose organization has website disabled — same product gate as resolve-domain', async () => {
      const { accessToken, organizationId } = await setupOrg(
        'domain-allowed-off-owner@korva.test',
        'Domain Allowed Off Org',
        ['website'],
      );
      await request(server)
        .patch('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ customDomain: 'www.allowed-off-test.com' })
        .expect(200);
      await request(server)
        .patch('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ enabledModules: ['catalog'] })
        .expect(200);

      await request(server)
        .get('/api/v1/public-sites/domain-allowed')
        .query({ domain: 'www.allowed-off-test.com' })
        .expect(404);
    });

    it('rejects a missing domain parameter rather than treating it as an empty host', async () => {
      await request(server)
        .get('/api/v1/public-sites/domain-allowed')
        .expect(400);
    });
  });
});
