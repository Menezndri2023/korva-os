import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
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
  user: { id: string; email: string };
  accessToken: string;
  refreshToken: string;
}
interface OrganizationPayload {
  id: string;
  name: string;
}
interface MemberPayload {
  userId: { email: string };
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

describe('Multi-tenant isolation (e2e)', () => {
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
    // dropDatabase() also wipes the indexes Mongoose just built at connection
    // time — rebuild them explicitly (e.g. the unique membership/role indexes).
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

  async function registerAndLogin(email: string): Promise<AuthPayload> {
    const res = await request(server)
      .post('/api/v1/auth/register')
      .send({ email, password: 'password123', firstName: 'Test' })
      .expect(201);
    return asSuccess<AuthPayload>(res.body);
  }

  async function createOrganization(
    accessToken: string,
    name: string,
  ): Promise<string> {
    const res = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name,
        type: 'commerce',
        country: 'FR',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        language: 'fr',
      })
      .expect(201);
    return asSuccess<OrganizationPayload>(res.body).id;
  }

  describe('auth', () => {
    it('rejects login with wrong password', async () => {
      await registerAndLogin('wrongpass@korva.test');
      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'wrongpass@korva.test', password: 'nope' })
        .expect(401);
    });

    it('rejects duplicate registration', async () => {
      await registerAndLogin('dup@korva.test');
      await request(server)
        .post('/api/v1/auth/register')
        .send({ email: 'dup@korva.test', password: 'password123' })
        .expect(409);
    });
  });

  describe('organization creation and membership', () => {
    it('makes the creator the OWNER and lets them read their own organization', async () => {
      const { accessToken } = await registerAndLogin('owner1@korva.test');
      const orgId = await createOrganization(accessToken, 'Solo Org');

      const res = await request(server)
        .get('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', orgId)
        .expect(200);

      const org = asSuccess<OrganizationPayload>(res.body);
      expect(org.id).toBe(orgId);
      expect(org.name).toBe('Solo Org');
    });

    it('only lists organizations the user actually belongs to', async () => {
      const { accessToken } = await registerAndLogin('lister@korva.test');
      const orgId = await createOrganization(accessToken, 'Lister Org');

      const res = await request(server)
        .get('/api/v1/organizations/me/all')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const orgs = asSuccess<OrganizationPayload[]>(res.body);
      expect(orgs).toHaveLength(1);
      expect(orgs[0]?.id).toBe(orgId);
    });
  });

  describe('tenant isolation between two organizations', () => {
    let tokenA: string;
    let tokenB: string;
    let orgAId: string;
    let orgBId: string;

    beforeAll(async () => {
      const a = await registerAndLogin('alice-iso@korva.test');
      const b = await registerAndLogin('bob-iso@korva.test');
      tokenA = a.accessToken;
      tokenB = b.accessToken;
      orgAId = await createOrganization(tokenA, 'Org Alpha Iso');
      orgBId = await createOrganization(tokenB, 'Org Beta Iso');
    });

    it('rejects a tenant-scoped request with no X-Organization-Id header', async () => {
      await request(server)
        .get('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(403);
    });

    it('denies user B reading org A by passing org A id in the header', async () => {
      const res = await request(server)
        .get('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${tokenB}`)
        .set('X-Organization-Id', orgAId)
        .expect(403);
      expect(asError(res.body).code).toBe('ORGANIZATION_ACCESS_DENIED');
    });

    it('denies user A reading org B by passing org B id in the header', async () => {
      await request(server)
        .get('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Organization-Id', orgBId)
        .expect(403);
    });

    it('denies user B updating org A', async () => {
      await request(server)
        .patch('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${tokenB}`)
        .set('X-Organization-Id', orgAId)
        .send({ name: 'Hijacked Name' })
        .expect(403);
    });

    it('denies user B listing org A members', async () => {
      await request(server)
        .get('/api/v1/organizations/me/members')
        .set('Authorization', `Bearer ${tokenB}`)
        .set('X-Organization-Id', orgAId)
        .expect(403);
    });

    it('never leaks org A data into org B member listing', async () => {
      const res = await request(server)
        .get('/api/v1/organizations/me/members')
        .set('Authorization', `Bearer ${tokenB}`)
        .set('X-Organization-Id', orgBId)
        .expect(200);

      const members = asSuccess<MemberPayload[]>(res.body);
      expect(members.map((m) => m.userId.email)).toEqual([
        'bob-iso@korva.test',
      ]);
    });

    it('still allows each user to operate normally on their own organization', async () => {
      await request(server)
        .patch('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Organization-Id', orgAId)
        .send({ name: 'Org Alpha Renamed' })
        .expect(200);

      const res = await request(server)
        .get('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Organization-Id', orgAId)
        .expect(200);
      expect(asSuccess<OrganizationPayload>(res.body).name).toBe(
        'Org Alpha Renamed',
      );
    });
  });

  describe('RBAC permission enforcement', () => {
    it('blocks a STAFF member (no settings.manage) from updating the organization, but allows the OWNER', async () => {
      const owner = await registerAndLogin('rbac-owner@korva.test');
      const staff = await registerAndLogin('rbac-staff@korva.test');
      const orgId = await createOrganization(owner.accessToken, 'RBAC Org');

      // No roles-listing endpoint exists yet in Phase 1, so resolve the seeded
      // STAFF role id directly against the database to add the staff member.
      const staffRole = await connection.collection('roles').findOne({
        organizationId: new Types.ObjectId(orgId),
        systemKey: 'STAFF',
      });
      expect(staffRole).not.toBeNull();

      await request(server)
        .post('/api/v1/organizations/me/members')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set('X-Organization-Id', orgId)
        .send({
          email: 'rbac-staff@korva.test',
          roleId: String(staffRole?._id),
        })
        .expect(201);

      // OWNER can update settings.
      await request(server)
        .patch('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set('X-Organization-Id', orgId)
        .send({ name: 'RBAC Org Updated' })
        .expect(200);

      // STAFF is a real member (can read) but lacks settings.manage.
      await request(server)
        .get('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${staff.accessToken}`)
        .set('X-Organization-Id', orgId)
        .expect(200);

      const res = await request(server)
        .patch('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${staff.accessToken}`)
        .set('X-Organization-Id', orgId)
        .send({ name: 'Should Not Work' })
        .expect(403);
      expect(asError(res.body).code).toBe('PERMISSION_DENIED');
    });
  });

  describe('role-hierarchy enforcement on addMember', () => {
    it('blocks an ADMIN from assigning OWNER over the real HTTP endpoint, and creates no membership', async () => {
      const owner = await registerAndLogin('hier-owner@korva.test');
      const admin = await registerAndLogin('hier-admin@korva.test');
      const victim = await registerAndLogin('hier-victim@korva.test');
      const orgId = await createOrganization(
        owner.accessToken,
        'Hierarchy Org',
      );

      const adminRole = await connection.collection('roles').findOne({
        organizationId: new Types.ObjectId(orgId),
        systemKey: 'ADMIN',
      });
      const ownerRole = await connection.collection('roles').findOne({
        organizationId: new Types.ObjectId(orgId),
        systemKey: 'OWNER',
      });
      expect(adminRole).not.toBeNull();
      expect(ownerRole).not.toBeNull();

      // OWNER promotes hier-admin to ADMIN — this must keep working.
      await request(server)
        .post('/api/v1/organizations/me/members')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set('X-Organization-Id', orgId)
        .send({
          email: 'hier-admin@korva.test',
          roleId: String(adminRole?._id),
        })
        .expect(201);

      // ADMIN attempts to add hier-victim as OWNER — must be rejected.
      const res = await request(server)
        .post('/api/v1/organizations/me/members')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('X-Organization-Id', orgId)
        .send({
          email: 'hier-victim@korva.test',
          roleId: String(ownerRole?._id),
        })
        .expect(403);
      expect(asError(res.body).code).toBe('ROLE_HIERARCHY_VIOLATION');

      // No membership should have been created for hier-victim at all.
      const victimMembership = await connection
        .collection('memberships')
        .findOne({
          organizationId: new Types.ObjectId(orgId),
          userId: new Types.ObjectId(victim.user.id),
        });
      expect(victimMembership).toBeNull();
    });
  });
});
