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
  accessToken: string;
}
interface OrganizationPayload {
  id: string;
}
interface RolePayload {
  id: string;
  name: string;
  systemKey?: string;
}
interface ApiKeyPayload {
  id: string;
  name: string;
  keyPrefix: string;
  roleId: string;
  revokedAt: string | null;
  expiresAt: string | null;
}
interface CreatedApiKeyPayload extends ApiKeyPayload {
  key: string;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

/**
 * WAVE 2.1 AGENT D — org-scoped API keys for server-to-server auth: creation/listing/revocation/
 * rotation over the normal JWT-authenticated dashboard chain, and ApiKeyGuard's `X-API-Key`
 * authentication path (see apps/api/src/core/guards/api-key.guard.ts and
 * apps/api/src/identity/api-keys/*).
 */
describe('API keys (e2e)', () => {
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

  async function registerOrgAndToken(email: string, orgName: string) {
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

    return { accessToken, organization };
  }

  async function roleId(
    accessToken: string,
    organizationId: string,
    systemKey: string,
  ): Promise<string> {
    const res = await request(server)
      .get('/api/v1/organizations/me/roles')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    const roles = asSuccess<RolePayload[]>(res.body);
    const role = roles.find((r) => r.systemKey === systemKey);
    if (!role) throw new Error(`Role ${systemKey} not found`);
    return role.id;
  }

  async function createApiKey(
    accessToken: string,
    organizationId: string,
    body: { name: string; roleId: string; expiresAt?: string },
  ): Promise<CreatedApiKeyPayload> {
    const res = await request(server)
      .post('/api/v1/organizations/me/api-keys')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send(body)
      .expect(201);
    return asSuccess<CreatedApiKeyPayload>(res.body);
  }

  describe('creation, listing, and secret handling', () => {
    it('creates a key, returns the plaintext exactly once, and never leaks it from list()', async () => {
      const { accessToken, organization } = await registerOrgAndToken(
        'apikey-create@korva.test',
        'Api Key Create Org',
      );
      const ownerRoleId = await roleId(accessToken, organization.id, 'OWNER');

      const created = await createApiKey(accessToken, organization.id, {
        name: 'CI pipeline',
        roleId: ownerRoleId,
      });
      expect(created.key).toMatch(/^korva_live_/);
      expect(created.keyPrefix).toBe(
        created.key.slice(0, created.keyPrefix.length),
      );
      expect(created.revokedAt).toBeNull();

      const listRes = await request(server)
        .get('/api/v1/organizations/me/api-keys')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organization.id)
        .expect(200);
      const list = asSuccess<Record<string, unknown>[]>(listRes.body);
      const listed = list.find((k) => k.id === created.id);
      expect(listed).toBeDefined();
      expect(listed).not.toHaveProperty('key');
      expect(listed).not.toHaveProperty('keyHash');

      // The hash actually stored in MongoDB must never equal the plaintext key.
      const stored = await connection
        .collection('api_keys')
        .findOne({ _id: new Types.ObjectId(created.id) });
      expect(stored?.keyHash).toBeDefined();
      expect(stored?.keyHash).not.toBe(created.key);
    });

    it('rejects creation with a roleId from a different organization', async () => {
      const { accessToken: tokenA, organization: orgA } =
        await registerOrgAndToken(
          'apikey-badrole-a@korva.test',
          'Bad Role Org A',
        );
      const { accessToken: tokenB, organization: orgB } =
        await registerOrgAndToken(
          'apikey-badrole-b@korva.test',
          'Bad Role Org B',
        );
      const orgBOwnerRoleId = await roleId(tokenB, orgB.id, 'OWNER');

      const res = await request(server)
        .post('/api/v1/organizations/me/api-keys')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Organization-Id', orgA.id)
        .send({ name: 'cross-org', roleId: orgBOwnerRoleId })
        .expect(400);
      expect(asError(res.body).code).toBe('ROLE_NOT_FOUND');
    });

    it('rejects creation by a member without settings.manage', async () => {
      const { accessToken: ownerToken, organization } =
        await registerOrgAndToken('apikey-perm-owner@korva.test', 'Perm Org');
      const staff = await request(server)
        .post('/api/v1/auth/register')
        .send({
          email: 'apikey-perm-staff@korva.test',
          password: 'password123',
        })
        .expect(201);
      const staffToken = asSuccess<AuthPayload>(staff.body).accessToken;
      const staffRoleId = await roleId(ownerToken, organization.id, 'STAFF');
      await request(server)
        .post('/api/v1/organizations/me/members')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Organization-Id', organization.id)
        .send({ email: 'apikey-perm-staff@korva.test', roleId: staffRoleId })
        .expect(201);

      const res = await request(server)
        .post('/api/v1/organizations/me/api-keys')
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', organization.id)
        .send({ name: 'should fail', roleId: staffRoleId })
        .expect(403);
      expect(asError(res.body).code).toBe('PERMISSION_DENIED');
    });

    it('rejects an ADMIN issuing an OWNER-scoped key (role-hierarchy enforcement)', async () => {
      const { accessToken: ownerToken, organization } =
        await registerOrgAndToken(
          'apikey-hierarchy-owner@korva.test',
          'Hierarchy Org',
        );
      const admin = await request(server)
        .post('/api/v1/auth/register')
        .send({
          email: 'apikey-hierarchy-admin@korva.test',
          password: 'password123',
        })
        .expect(201);
      const adminToken = asSuccess<AuthPayload>(admin.body).accessToken;
      const adminRoleId = await roleId(ownerToken, organization.id, 'ADMIN');
      const ownerRoleId = await roleId(ownerToken, organization.id, 'OWNER');
      await request(server)
        .post('/api/v1/organizations/me/members')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Organization-Id', organization.id)
        .send({
          email: 'apikey-hierarchy-admin@korva.test',
          roleId: adminRoleId,
        })
        .expect(201);

      const res = await request(server)
        .post('/api/v1/organizations/me/api-keys')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Organization-Id', organization.id)
        .send({ name: 'owner-scoped from admin', roleId: ownerRoleId })
        .expect(403);
      expect(asError(res.body).code).toBe('ROLE_HIERARCHY_VIOLATION');

      // Sanity: the same ADMIN can still issue a key scoped at or below their own rank.
      await createApiKey(adminToken, organization.id, {
        name: 'admin-scoped from admin',
        roleId: adminRoleId,
      });
    });
  });

  describe('X-API-Key authentication', () => {
    it('authenticates a valid key and resolves its own organization', async () => {
      const { accessToken, organization } = await registerOrgAndToken(
        'apikey-valid@korva.test',
        'Valid Key Org',
      );
      const ownerRoleId = await roleId(accessToken, organization.id, 'OWNER');
      const created = await createApiKey(accessToken, organization.id, {
        name: 'valid key',
        roleId: ownerRoleId,
      });

      const res = await request(server)
        .get('/api/v1/organizations/me/api-keys/whoami')
        .set('X-API-Key', created.key)
        .expect(200);
      expect(
        asSuccess<{ organizationId: string }>(res.body).organizationId,
      ).toBe(organization.id);
    });

    it('rejects a missing key', async () => {
      const res = await request(server)
        .get('/api/v1/organizations/me/api-keys/whoami')
        .expect(401);
      expect(asError(res.body).code).toBe('API_KEY_REQUIRED');
    });

    it('rejects an invalid/unknown key', async () => {
      const res = await request(server)
        .get('/api/v1/organizations/me/api-keys/whoami')
        .set('X-API-Key', 'korva_live_totally-made-up-key')
        .expect(401);
      expect(asError(res.body).code).toBe('INVALID_API_KEY');
    });

    it('rejects a revoked key', async () => {
      const { accessToken, organization } = await registerOrgAndToken(
        'apikey-revoked@korva.test',
        'Revoked Key Org',
      );
      const ownerRoleId = await roleId(accessToken, organization.id, 'OWNER');
      const created = await createApiKey(accessToken, organization.id, {
        name: 'to be revoked',
        roleId: ownerRoleId,
      });

      // Sanity: it works before revocation.
      await request(server)
        .get('/api/v1/organizations/me/api-keys/whoami')
        .set('X-API-Key', created.key)
        .expect(200);

      await request(server)
        .delete(`/api/v1/organizations/me/api-keys/${created.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organization.id)
        .expect(200);

      const res = await request(server)
        .get('/api/v1/organizations/me/api-keys/whoami')
        .set('X-API-Key', created.key)
        .expect(401);
      expect(asError(res.body).code).toBe('API_KEY_REVOKED');
    });

    it('rejects an expired key', async () => {
      const { accessToken, organization } = await registerOrgAndToken(
        'apikey-expired@korva.test',
        'Expired Key Org',
      );
      const ownerRoleId = await roleId(accessToken, organization.id, 'OWNER');
      const created = await createApiKey(accessToken, organization.id, {
        name: 'to expire',
        roleId: ownerRoleId,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });

      // Force it into the past — same technique as invitations/password-reset e2e specs.
      await connection
        .collection('api_keys')
        .updateOne(
          { _id: new Types.ObjectId(created.id) },
          { $set: { expiresAt: new Date(Date.now() - 1000) } },
        );

      const res = await request(server)
        .get('/api/v1/organizations/me/api-keys/whoami')
        .set('X-API-Key', created.key)
        .expect(401);
      expect(asError(res.body).code).toBe('API_KEY_EXPIRED');
    });

    it('rejects creation with an expiresAt already in the past', async () => {
      const { accessToken, organization } = await registerOrgAndToken(
        'apikey-bad-expiry@korva.test',
        'Bad Expiry Org',
      );
      const ownerRoleId = await roleId(accessToken, organization.id, 'OWNER');

      const res = await request(server)
        .post('/api/v1/organizations/me/api-keys')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organization.id)
        .send({
          name: 'already expired',
          roleId: ownerRoleId,
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
        })
        .expect(400);
      expect(asError(res.body).code).toBe('INVALID_EXPIRATION');
    });
  });

  describe('tenant isolation between two organizations', () => {
    it('never resolves org A key to org B or vice versa', async () => {
      const { accessToken: tokenA, organization: orgA } =
        await registerOrgAndToken('apikey-iso-a@korva.test', 'Iso Org A');
      const { accessToken: tokenB, organization: orgB } =
        await registerOrgAndToken('apikey-iso-b@korva.test', 'Iso Org B');
      const ownerRoleA = await roleId(tokenA, orgA.id, 'OWNER');
      const ownerRoleB = await roleId(tokenB, orgB.id, 'OWNER');

      const keyA = await createApiKey(tokenA, orgA.id, {
        name: 'org A key',
        roleId: ownerRoleA,
      });
      const keyB = await createApiKey(tokenB, orgB.id, {
        name: 'org B key',
        roleId: ownerRoleB,
      });

      const resA = await request(server)
        .get('/api/v1/organizations/me/api-keys/whoami')
        .set('X-API-Key', keyA.key)
        .expect(200);
      expect(
        asSuccess<{ organizationId: string }>(resA.body).organizationId,
      ).toBe(orgA.id);

      const resB = await request(server)
        .get('/api/v1/organizations/me/api-keys/whoami')
        .set('X-API-Key', keyB.key)
        .expect(200);
      expect(
        asSuccess<{ organizationId: string }>(resB.body).organizationId,
      ).toBe(orgB.id);

      // Neither key ever resolves to the other organization.
      expect(
        asSuccess<{ organizationId: string }>(resA.body).organizationId,
      ).not.toBe(orgB.id);
    });

    it('a revoked org A key stays dead — it never falls back to authenticating as some other organization', async () => {
      const { accessToken: tokenA, organization: orgA } =
        await registerOrgAndToken(
          'apikey-iso-revoke-a@korva.test',
          'Iso Revoke A',
        );
      const ownerRoleA = await roleId(tokenA, orgA.id, 'OWNER');
      const keyA = await createApiKey(tokenA, orgA.id, {
        name: 'org A key to revoke',
        roleId: ownerRoleA,
      });

      await request(server)
        .delete(`/api/v1/organizations/me/api-keys/${keyA.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Organization-Id', orgA.id)
        .expect(200);

      const res = await request(server)
        .get('/api/v1/organizations/me/api-keys/whoami')
        .set('X-API-Key', keyA.key)
        .expect(401);
      expect(asError(res.body).code).toBe('API_KEY_REVOKED');
    });
  });

  describe('scope / permission enforcement for API-key-authenticated requests', () => {
    it('rejects a STAFF-role key on a settings.manage-gated route, but allows an OWNER-role key', async () => {
      const { accessToken, organization } = await registerOrgAndToken(
        'apikey-scope@korva.test',
        'Scope Org',
      );
      const ownerRoleId = await roleId(accessToken, organization.id, 'OWNER');
      const staffRoleId = await roleId(accessToken, organization.id, 'STAFF');

      const staffKey = await createApiKey(accessToken, organization.id, {
        name: 'read-only key',
        roleId: staffRoleId,
      });
      const ownerKey = await createApiKey(accessToken, organization.id, {
        name: 'full-access key',
        roleId: ownerRoleId,
      });

      const staffRes = await request(server)
        .get('/api/v1/organizations/me/api-keys/whoami/settings-check')
        .set('X-API-Key', staffKey.key)
        .expect(403);
      expect(asError(staffRes.body).code).toBe('PERMISSION_DENIED');

      await request(server)
        .get('/api/v1/organizations/me/api-keys/whoami/settings-check')
        .set('X-API-Key', ownerKey.key)
        .expect(200);
    });
  });

  describe('rotation', () => {
    it('rotating a key invalidates the old plaintext and activates a new one', async () => {
      const { accessToken, organization } = await registerOrgAndToken(
        'apikey-rotate@korva.test',
        'Rotate Org',
      );
      const ownerRoleId = await roleId(accessToken, organization.id, 'OWNER');
      const created = await createApiKey(accessToken, organization.id, {
        name: 'to rotate',
        roleId: ownerRoleId,
      });

      // Works before rotation.
      await request(server)
        .get('/api/v1/organizations/me/api-keys/whoami')
        .set('X-API-Key', created.key)
        .expect(200);

      const rotateRes = await request(server)
        .post(`/api/v1/organizations/me/api-keys/${created.id}/rotate`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organization.id)
        .expect(201);
      const rotated = asSuccess<CreatedApiKeyPayload>(rotateRes.body);
      expect(rotated.key).not.toBe(created.key);

      // Old plaintext now fails...
      const oldRes = await request(server)
        .get('/api/v1/organizations/me/api-keys/whoami')
        .set('X-API-Key', created.key)
        .expect(401);
      expect(asError(oldRes.body).code).toBe('API_KEY_REVOKED');

      // ...new plaintext succeeds, resolving the same organization.
      const newRes = await request(server)
        .get('/api/v1/organizations/me/api-keys/whoami')
        .set('X-API-Key', rotated.key)
        .expect(200);
      expect(
        asSuccess<{ organizationId: string }>(newRes.body).organizationId,
      ).toBe(organization.id);
    });

    it('cannot rotate an already-revoked key', async () => {
      const { accessToken, organization } = await registerOrgAndToken(
        'apikey-rotate-revoked@korva.test',
        'Rotate Revoked Org',
      );
      const ownerRoleId = await roleId(accessToken, organization.id, 'OWNER');
      const created = await createApiKey(accessToken, organization.id, {
        name: 'to revoke then rotate',
        roleId: ownerRoleId,
      });

      await request(server)
        .delete(`/api/v1/organizations/me/api-keys/${created.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organization.id)
        .expect(200);

      const res = await request(server)
        .post(`/api/v1/organizations/me/api-keys/${created.id}/rotate`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organization.id)
        .expect(403);
      expect(asError(res.body).code).toBe('API_KEY_REVOKED');
    });
  });
});
