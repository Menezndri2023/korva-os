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
}
interface CustomerAuthPayload {
  accessToken: string;
  refreshToken: string;
  customer: { id: string; email: string; firstName?: string };
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

describe('Customer portal auth (e2e)', () => {
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

  async function setupOrg(email: string, orgName: string): Promise<string> {
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

    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .send({ enabledModules: ['crm', 'catalog', 'booking', 'commerce'] })
      .expect(200);

    return organization.slug;
  }

  describe('register/login', () => {
    let slug: string;

    beforeAll(async () => {
      slug = await setupOrg('owner-cust-1@example.com', 'Cust Auth Org 1');
    });

    it('registers a new customer and issues tokens', async () => {
      const res = await request(server)
        .post(`/api/v1/public/${slug}/account/register`)
        .send({
          email: 'client1@example.com',
          password: 'clientpass123',
          firstName: 'Alice',
        })
        .expect(201);
      const body = asSuccess<CustomerAuthPayload>(res.body);
      expect(body.accessToken).toBeDefined();
      expect(body.refreshToken).toBeDefined();
      expect(body.customer.email).toBe('client1@example.com');
    });

    it('rejects a duplicate email within the same organization', async () => {
      const res = await request(server)
        .post(`/api/v1/public/${slug}/account/register`)
        .send({ email: 'client1@example.com', password: 'clientpass123' })
        .expect(409);
      expect(asError(res.body).code).toBe('EMAIL_TAKEN');
    });

    it('allows the same email to register independently in a different organization', async () => {
      const otherSlug = await setupOrg(
        'owner-cust-2@example.com',
        'Cust Auth Org 2',
      );
      await request(server)
        .post(`/api/v1/public/${otherSlug}/account/register`)
        .send({ email: 'client1@example.com', password: 'clientpass123' })
        .expect(201);
    });

    it('logs in with correct credentials', async () => {
      const res = await request(server)
        .post(`/api/v1/public/${slug}/account/login`)
        .send({ email: 'client1@example.com', password: 'clientpass123' })
        .expect(201);
      const body = asSuccess<CustomerAuthPayload>(res.body);
      expect(body.accessToken).toBeDefined();
    });

    it('rejects an incorrect password', async () => {
      const res = await request(server)
        .post(`/api/v1/public/${slug}/account/login`)
        .send({ email: 'client1@example.com', password: 'wrong-password' })
        .expect(401);
      expect(asError(res.body).code).toBe('INVALID_CREDENTIALS');
    });

    it('locks the account after 5 failed attempts', async () => {
      const email = 'lockout-target@example.com';
      await request(server)
        .post(`/api/v1/public/${slug}/account/register`)
        .send({ email, password: 'clientpass123' })
        .expect(201);

      for (let i = 0; i < 5; i++) {
        await request(server)
          .post(`/api/v1/public/${slug}/account/login`)
          .send({ email, password: 'wrong-password' })
          .expect(401);
      }

      const res = await request(server)
        .post(`/api/v1/public/${slug}/account/login`)
        .send({ email, password: 'clientpass123' })
        .expect(401);
      expect(asError(res.body).code).toBe('ACCOUNT_LOCKED');
    });
  });

  describe('cross-boundary and tenant isolation', () => {
    let slugA: string;
    let slugB: string;
    let customerTokenOrgA: string;
    let staffTokenOrgA: string;

    beforeAll(async () => {
      slugA = await setupOrg('owner-cust-3@example.com', 'Cust Auth Org 3');
      slugB = await setupOrg('owner-cust-4@example.com', 'Cust Auth Org 4');

      const authRes = await request(server)
        .post('/api/v1/auth/register')
        .send({
          email: 'staff-cust-boundary@example.com',
          password: 'password123',
        })
        .expect(201);
      staffTokenOrgA = asSuccess<AuthPayload>(authRes.body).accessToken;

      const registerRes = await request(server)
        .post(`/api/v1/public/${slugA}/account/register`)
        .send({
          email: 'boundary-client@example.com',
          password: 'clientpass123',
        })
        .expect(201);
      customerTokenOrgA = asSuccess<CustomerAuthPayload>(
        registerRes.body,
      ).accessToken;
    });

    it('rejects a customer access token used against a staff-only endpoint', async () => {
      await request(server)
        .get('/api/v1/contacts')
        .set('Authorization', `Bearer ${customerTokenOrgA}`)
        .set('X-Organization-Id', 'irrelevant')
        .expect(401);
    });

    it('rejects a staff access token used against the customer /me endpoint', async () => {
      await request(server)
        .get(`/api/v1/public/${slugA}/account/me`)
        .set('Authorization', `Bearer ${staffTokenOrgA}`)
        .expect(401);
    });

    it("rejects a customer token for org A when presented against org B's slug", async () => {
      await request(server)
        .get(`/api/v1/public/${slugB}/account/me`)
        .set('Authorization', `Bearer ${customerTokenOrgA}`)
        .expect(401);
    });

    it('returns the profile for the correct org+slug combination', async () => {
      const res = await request(server)
        .get(`/api/v1/public/${slugA}/account/me`)
        .set('Authorization', `Bearer ${customerTokenOrgA}`)
        .expect(200);
      expect(asSuccess<{ email: string }>(res.body).email).toBe(
        'boundary-client@example.com',
      );
    });
  });

  describe('order/booking history isolation', () => {
    let slug: string;
    let organizationId: string;
    let staffToken: string;
    let customerAToken: string;
    let customerBToken: string;
    let offerId: string;

    beforeAll(async () => {
      const authRes = await request(server)
        .post('/api/v1/auth/register')
        .send({ email: 'owner-cust-5@example.com', password: 'password123' })
        .expect(201);
      staffToken = asSuccess<AuthPayload>(authRes.body).accessToken;

      const orgRes = await request(server)
        .post('/api/v1/organizations')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          name: 'Cust Auth Org 5',
          type: 'commerce',
          country: 'FR',
          currency: 'EUR',
          timezone: 'Europe/Paris',
          language: 'fr',
        })
        .expect(201);
      const organization = asSuccess<OrganizationPayload>(orgRes.body);
      slug = organization.slug;
      organizationId = organization.id;

      await request(server)
        .patch('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ enabledModules: ['crm', 'catalog', 'commerce'] })
        .expect(200);

      const offerRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'product',
          name: 'Widget',
          status: 'active',
          pricing: { amount: 20, currency: 'EUR' },
        })
        .expect(201);
      offerId = asSuccess<{ id: string }>(offerRes.body).id;

      const regA = await request(server)
        .post(`/api/v1/public/${slug}/account/register`)
        .send({ email: 'history-a@example.com', password: 'clientpass123' })
        .expect(201);
      customerAToken = asSuccess<CustomerAuthPayload>(regA.body).accessToken;

      const regB = await request(server)
        .post(`/api/v1/public/${slug}/account/register`)
        .send({ email: 'history-b@example.com', password: 'clientpass123' })
        .expect(201);
      customerBToken = asSuccess<CustomerAuthPayload>(regB.body).accessToken;

      // Customer A places an order via the guest checkout path (email-matched to their account).
      await request(server)
        .post(`/api/v1/public/${slug}/orders`)
        .send({
          items: [{ offerId, quantity: 1 }],
          currency: 'EUR',
          contact: { email: 'history-a@example.com', firstName: 'A' },
        })
        .expect(201);
    });

    it("only returns the authenticated customer's own orders", async () => {
      const resA = await request(server)
        .get(`/api/v1/public/${slug}/account/orders`)
        .set('Authorization', `Bearer ${customerAToken}`)
        .expect(200);
      expect(asSuccess<unknown[]>(resA.body)).toHaveLength(1);

      const resB = await request(server)
        .get(`/api/v1/public/${slug}/account/orders`)
        .set('Authorization', `Bearer ${customerBToken}`)
        .expect(200);
      expect(asSuccess<unknown[]>(resB.body)).toHaveLength(0);
    });
  });

  describe('password reset', () => {
    let slug: string;

    beforeAll(async () => {
      slug = await setupOrg('owner-cust-6@example.com', 'Cust Auth Org 6');
      await request(server)
        .post(`/api/v1/public/${slug}/account/register`)
        .send({ email: 'reset-target@example.com', password: 'original-pass' })
        .expect(201);
    });

    it('accepts a forgot-password request with a generic response regardless of existence', async () => {
      const known = await request(server)
        .post(`/api/v1/public/${slug}/account/forgot-password`)
        .send({ email: 'reset-target@example.com' })
        .expect(201);
      const unknown = await request(server)
        .post(`/api/v1/public/${slug}/account/forgot-password`)
        .send({ email: 'never-registered@example.com' })
        .expect(201);
      expect(asSuccess<{ message: string }>(known.body).message).toBe(
        asSuccess<{ message: string }>(unknown.body).message,
      );
    });

    it('rejects an invalid reset token', async () => {
      const res = await request(server)
        .post(`/api/v1/public/${slug}/account/reset-password`)
        .send({ token: 'not-a-real-token', password: 'new-password-123' })
        .expect(401);
      expect(asError(res.body).code).toBe('INVALID_RESET_TOKEN');
    });
  });
});
