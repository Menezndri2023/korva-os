import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PlatformAdminAuthService } from './../src/platform-admin/platform-admin-auth.service';

/**
 * "Voir son tableau de bord": the administration opens a business's dashboard with a token that
 * reads that one organization and nothing else — no write, no other organization of the same
 * owner, no administration route — and leaves a line in the business's journal.
 */

interface ApiSuccess<T> {
  success: true;
  data: T;
}
function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function codeOf(body: unknown): string {
  return (body as { error: { code: string } }).error.code;
}

describe('Platform view-as (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  let adminToken: string;

  beforeAll(async () => {
    process.env.PLATFORM_ADMIN_EMAILS = 'viewas@korva.test';
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
    const { password } = await app
      .get(PlatformAdminAuthService)
      .provision('viewas@korva.test');
    adminToken = asSuccess<{ accessToken: string }>(
      (
        await request(server)
          .post('/api/v1/platform/auth/login')
          .send({ email: 'viewas@korva.test', password })
          .expect(200)
      ).body,
    ).accessToken;
  }, 120_000);

  afterAll(async () => {
    delete process.env.PLATFORM_ADMIN_EMAILS;
    await connection.dropDatabase();
    await app.close();
  });

  it('reads one business in its owner’s name, and nothing more', async () => {
    const ownerToken = asSuccess<{ accessToken: string }>(
      (
        await request(server)
          .post('/api/v1/auth/register')
          .send({ email: 'awa@viewas.ci', password: 'password123' })
          .expect(201)
      ).body,
    ).accessToken;
    const createOrg = async (name: string) =>
      asSuccess<{ id: string }>(
        (
          await request(server)
            .post('/api/v1/organizations')
            .set('Authorization', `Bearer ${ownerToken}`)
            .send({
              name,
              type: 'beauté',
              country: 'CI',
              currency: 'XOF',
              timezone: 'Africa/Abidjan',
              language: 'fr',
            })
            .expect(201)
        ).body,
      ).id;
    const salon = await createOrg('Salon Vue');
    const other = await createOrg('Autre Salon');

    // A business token cannot ask for a view.
    await request(server)
      .post(`/api/v1/platform/organizations/${salon}/view-as`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(403);

    const view = asSuccess<{
      accessToken: string;
      organizationId: string;
      expiresAt: string;
      user: { email: string };
    }>(
      (
        await request(server)
          .post(`/api/v1/platform/organizations/${salon}/view-as`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200)
      ).body,
    );
    expect(view.organizationId).toBe(salon);
    expect(view.user.email).toBe('awa@viewas.ci');
    const minutes = (new Date(view.expiresAt).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(25);
    expect(minutes).toBeLessThanOrEqual(30);

    const asView = (req: request.Test, organizationId = salon) =>
      req
        .set('Authorization', `Bearer ${view.accessToken}`)
        .set('X-Organization-Id', organizationId);

    // Reads.
    const me = await asView(
      request(server).get('/api/v1/organizations/me'),
    ).expect(200);
    expect(asSuccess<{ name: string }>(me.body).name).toBe('Salon Vue');
    await asView(request(server).get('/api/v1/contacts')).expect(200);

    // Never writes, wherever it goes.
    for (const [method, path, body] of [
      ['patch', '/api/v1/organizations/me', { name: 'Piraté' }],
      ['post', '/api/v1/contacts', { type: 'person', firstName: 'X' }],
      ['post', '/api/v1/auth/logout', {}],
    ] as const) {
      const res = await asView(request(server)[method](path)).send(body);
      expect(res.status).toBe(403);
      expect(codeOf(res.body)).toBe('VIEW_ONLY');
    }

    // Never the owner's other business.
    const elsewhere = await asView(
      request(server).get('/api/v1/organizations/me'),
      other,
    ).expect(403);
    expect(codeOf(elsewhere.body)).toBe('ORGANIZATION_ACCESS_DENIED');

    // Never the administration.
    await request(server)
      .get('/api/v1/platform/todo')
      .set('Authorization', `Bearer ${view.accessToken}`)
      .expect(403);

    // The business's journal says who looked.
    const entry = await connection.collection('audit_logs').findOne({
      entity: 'organization',
      entityId: salon,
      'metadata.viewAs': true,
    });
    expect(entry).not.toBeNull();
  });
});
