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
  enabledModules: string[];
  visibleSections: string[];
  storefrontTheme: { template: string };
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}

/**
 * Phase E1 (docs/KORVA_OS_V2_AUDIT.md §2.6/§3): explicit end-to-end proof that an organization
 * with ONLY the "website" product active — every other module (catalog/booking/commerce/crm)
 * left off — still gets a fully working public storefront page, not just that "website" gates
 * the page (already covered by public.e2e-spec.ts's module-gating describe block). A standalone
 * file, not a new describe block in public.e2e-spec.ts, since that file already sits at 25
 * registrations against the documented 30-per-60s AUTH_THROTTLE budget.
 */
describe('Website-only product activation (Phase E1, e2e)', () => {
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

  it('renders GET /public/:slug for an org with enabledModules: ["website"] only, with no other product active', async () => {
    const authRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email: 'website-only-owner@korva.test', password: 'password123' })
      .expect(201);
    const accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Website Only Org',
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

    // Strip every module down to exactly ["website"] — no catalog, no booking, no commerce, no
    // crm, no finance, no ai, nothing else at all.
    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ enabledModules: ['website'] })
      .expect(200);

    const pageRes = await request(server)
      .get(`/api/v1/public/${slug}`)
      .expect(200);
    const page = asSuccess<PublicOrganizationPayload>(pageRes.body);

    expect(page.name).toBe('Website Only Org');
    expect(page.enabledModules).toEqual(['website']);
    // No section requires another module to be enabled — every STOREFRONT_SECTIONS entry is
    // itself a module name, so with only "website" on, none of them qualify.
    expect(page.visibleSections).toEqual([]);
    // The page still resolves a real template (falls back to "essentiel" on a free plan) rather
    // than erroring or omitting theming.
    expect(page.storefrontTheme.template).toBeTruthy();

    // The catalog-only public route genuinely stays unreachable — this org really has no other
    // product active, this isn't just an empty-but-still-technically-on catalog.
    await request(server).get(`/api/v1/public/${slug}/offers`).expect(404);
  });
});
