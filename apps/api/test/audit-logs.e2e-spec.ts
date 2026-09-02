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
}
interface AuditLogPayload {
  id: string;
  organizationId: string;
  action: string;
  entity: string;
  entityId?: string;
}
interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
// ResponseInterceptor flattens paginated results to { success, data: [...], pagination } rather
// than nesting — data IS the array directly, not { data: { data: [...] } } (see
// commerce.e2e-spec.ts's own identical comment on this exact convention).
interface ApiPaginatedSuccess<T> {
  success: true;
  data: T[];
  pagination: Pagination;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}

/**
 * First read surface for AuditService.record — writes have happened from dozens of call sites
 * since early in this project, but nothing could ever query them via the API until now.
 */
describe('Audit logs (e2e)', () => {
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

  async function registerOrg(email: string, orgName: string) {
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
        type: 'service',
        country: 'FR',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        language: 'fr',
      })
      .expect(201);
    const organizationId = asSuccess<OrganizationPayload>(orgRes.body).id;

    return { accessToken, organizationId };
  }

  it('lists audit entries the org itself already generated, paginated and newest-first', async () => {
    const { accessToken, organizationId } = await registerOrg(
      'audit-basic@korva.test',
      'Audit Basic Org',
    );

    // Creating an org already writes one CREATE/organization entry (OrganizationsService).
    // Creating an offer writes a second, distinct CREATE/offer entry a moment later.
    await request(server)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        type: 'product',
        name: 'Audit Test Offer',
        pricing: { amount: 10, currency: 'EUR' },
      })
      .expect(201);

    const res = await request(server)
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    const page = res.body as ApiPaginatedSuccess<AuditLogPayload>;

    expect(page.pagination.total).toBeGreaterThanOrEqual(2);
    expect(
      page.data.every((entry) => entry.organizationId === organizationId),
    ).toBe(true);
    // The offer creation happened strictly after the organization's own — newest first.
    expect(page.data[0]?.entity).toBe('offer');
    expect(page.data[0]?.action).toBe('CREATE');
  });

  it('filters by action and entity', async () => {
    const { accessToken, organizationId } = await registerOrg(
      'audit-filter@korva.test',
      'Audit Filter Org',
    );
    await request(server)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        type: 'product',
        name: 'Filtered Offer',
        pricing: { amount: 10, currency: 'EUR' },
      })
      .expect(201);

    const res = await request(server)
      .get('/api/v1/audit-logs?action=CREATE&entity=offer')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    const page = res.body as ApiPaginatedSuccess<AuditLogPayload>;

    expect(page.data.length).toBeGreaterThan(0);
    expect(
      page.data.every(
        (entry) => entry.action === 'CREATE' && entry.entity === 'offer',
      ),
    ).toBe(true);

    const orgOnly = await request(server)
      .get('/api/v1/audit-logs?entity=organization')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    const orgPage = orgOnly.body as ApiPaginatedSuccess<AuditLogPayload>;
    expect(orgPage.data.every((entry) => entry.entity === 'organization')).toBe(
      true,
    );
    expect(orgPage.data.some((entry) => entry.entity === 'offer')).toBe(false);
  });

  it("never leaks another organization's audit trail", async () => {
    const orgA = await registerOrg(
      'audit-isolation-a@korva.test',
      'Audit Isolation A',
    );
    const orgB = await registerOrg(
      'audit-isolation-b@korva.test',
      'Audit Isolation B',
    );

    await request(server)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${orgA.accessToken}`)
      .set('X-Organization-Id', orgA.organizationId)
      .send({
        type: 'product',
        name: 'Org A Offer',
        pricing: { amount: 10, currency: 'EUR' },
      })
      .expect(201);

    const res = await request(server)
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${orgB.accessToken}`)
      .set('X-Organization-Id', orgB.organizationId)
      .expect(200);
    const page = res.body as ApiPaginatedSuccess<AuditLogPayload>;

    expect(
      page.data.every((entry) => entry.organizationId === orgB.organizationId),
    ).toBe(true);
    expect(page.data.some((entry) => entry.entity === 'offer')).toBe(false);
  });
});
