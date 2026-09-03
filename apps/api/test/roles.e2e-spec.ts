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
}
interface RolePayload {
  id: string;
  name: string;
  systemKey?: string;
  isSystem: boolean;
  permissions: string[];
}
interface MembershipPayload {
  id: string;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

describe('Custom roles (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  let ownerAccessToken: string;
  let organizationId: string;

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

    const authRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email: 'roles-owner@korva.test', password: 'password123' })
      .expect(201);
    ownerAccessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({
        name: 'Roles Org',
        type: 'service',
        country: 'FR',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        language: 'fr',
      })
      .expect(201);
    organizationId = asSuccess<OrganizationPayload>(orgRes.body).id;
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();
  });

  it('lists the six seeded system roles, none deletable/editable', async () => {
    const res = await request(server)
      .get('/api/v1/roles')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    const roles = asSuccess<RolePayload[]>(res.body);
    expect(roles.length).toBe(6);
    expect(roles.every((r) => r.isSystem)).toBe(true);

    const ownerRole = roles.find((r) => r.systemKey === 'OWNER')!;
    const editRes = await request(server)
      .patch(`/api/v1/roles/${ownerRole.id}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ name: 'Renamed Owner' })
      .expect(403);
    expect(asError(editRes.body).code).toBe('SYSTEM_ROLE_IMMUTABLE');

    const deleteRes = await request(server)
      .delete(`/api/v1/roles/${ownerRole.id}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(403);
    expect(asError(deleteRes.body).code).toBe('SYSTEM_ROLE_IMMUTABLE');
  });

  it('creates, updates, and deletes a custom role, and rejects a duplicate name', async () => {
    const createRes = await request(server)
      .post('/api/v1/roles')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        name: 'Concierge',
        permissions: ['contacts.read', 'contacts.create'],
      })
      .expect(201);
    const role = asSuccess<RolePayload>(createRes.body);
    expect(role.isSystem).toBe(false);
    expect(role.permissions.sort()).toEqual([
      'contacts.create',
      'contacts.read',
    ]);

    const dupRes = await request(server)
      .post('/api/v1/roles')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ name: 'Concierge', permissions: [] })
      .expect(409);
    expect(asError(dupRes.body).code).toBe('ROLE_NAME_TAKEN');

    const updateRes = await request(server)
      .patch(`/api/v1/roles/${role.id}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ permissions: ['contacts.read'] })
      .expect(200);
    expect(asSuccess<RolePayload>(updateRes.body).permissions).toEqual([
      'contacts.read',
    ]);

    await request(server)
      .delete(`/api/v1/roles/${role.id}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);

    const listRes = await request(server)
      .get('/api/v1/roles')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    expect(
      asSuccess<RolePayload[]>(listRes.body).some((r) => r.id === role.id),
    ).toBe(false);
  });

  it('rejects an invalid permission string', async () => {
    const res = await request(server)
      .post('/api/v1/roles')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        name: 'Bad Permissions Role',
        permissions: ['not.a.real.permission'],
      })
      .expect(400);
    expect((res.body as ApiError).success).toBe(false);
  });

  it('OWNER can assign a custom role to a member; refuses to delete a role currently in use', async () => {
    const memberAuthRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email: 'roles-member@korva.test', password: 'password123' })
      .expect(201);
    void memberAuthRes;

    const createRes = await request(server)
      .post('/api/v1/roles')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ name: 'Support Agent', permissions: ['contacts.read'] })
      .expect(201);
    const customRole = asSuccess<RolePayload>(createRes.body);

    const addRes = await request(server)
      .post('/api/v1/organizations/me/members')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ email: 'roles-member@korva.test', roleId: customRole.id })
      .expect(201);
    const membership = asSuccess<MembershipPayload>(addRes.body);
    expect(membership.id).toBeDefined();

    const deleteRes = await request(server)
      .delete(`/api/v1/roles/${customRole.id}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(409);
    expect(asError(deleteRes.body).code).toBe('ROLE_IN_USE');
  });
});
