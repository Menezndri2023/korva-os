import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import {
  EMAIL_PROVIDER,
  type EmailProvider,
  type EmailSendResult,
} from '../src/communication/providers/email-provider.interface';

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
  enabledModules: string[];
}
interface PlanPayload {
  key: string;
  modules: string[];
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

/**
 * P0-ORG-01: a freshly created organization must default to every module its plan actually
 * allows, not an empty enabledModules array — otherwise every module (CRM, Catalog, Booking,
 * Commerce, Finance, Analytics, Workflow, Communication, AI) is undiscoverable until someone
 * opts each one in manually via Settings.
 */
describe('Organizations module — default enabledModules on creation (e2e)', () => {
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

  it('gives a freshly created organization a non-empty enabledModules matching its "free" plan modules', async () => {
    const { accessToken, organization } = await registerOrgAndToken(
      'org-default-modules@korva.test',
      'Default Modules Org',
    );

    expect(organization.enabledModules.length).toBeGreaterThan(0);

    const plansRes = await request(server)
      .get('/api/v1/plans')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const freePlan = asSuccess<PlanPayload[]>(plansRes.body).find(
      (p) => p.key === 'free',
    );
    expect(freePlan).toBeDefined();

    expect([...organization.enabledModules].sort()).toEqual(
      [...(freePlan?.modules ?? [])].sort(),
    );

    // Re-fetch via GET to confirm the persisted value matches what creation returned.
    const meRes = await request(server)
      .get('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .expect(200);
    const persisted = asSuccess<OrganizationPayload>(meRes.body);
    expect([...persisted.enabledModules].sort()).toEqual(
      [...(freePlan?.modules ?? [])].sort(),
    );
  });

  it('still rejects enabling a module outside the plan after downgrading (entitlement enforcement unchanged)', async () => {
    const { accessToken, organization } = await registerOrgAndToken(
      'org-default-modules-gate@korva.test',
      'Default Modules Gate Org',
    );

    await request(server)
      .post('/api/v1/subscriptions/change-plan')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .send({ planKey: 'starter' })
      .expect(201);

    // "starter" excludes "workflow" and "ai" — attempting to (re-)enable "workflow" must
    // still be rejected even though it was part of the org's original default modules.
    const res = await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .send({ enabledModules: ['crm', 'workflow'] })
      .expect(403);
    expect(asError(res.body).code).toBe('MODULE_NOT_IN_PLAN');
  });
});

interface RolePayload {
  id: string;
  name: string;
  systemKey?: string;
}
interface MembershipPayload {
  id: string;
  userId: string | { _id: string; email: string };
  roleId: string | { _id: string; systemKey?: string };
  status: string;
}

/** Same email-capturing technique as password-reset.e2e-spec.ts — recovers the raw invitation
 *  token from the email body without any production-only backdoor. */
class CapturingEmailProvider implements EmailProvider {
  readonly name = 'capturing';
  readonly sent: { to: string; subject: string; body: string }[] = [];

  send(input: {
    to: string;
    subject: string;
    body: string;
  }): Promise<EmailSendResult> {
    this.sent.push(input);
    return Promise.resolve({ providerReference: 'captured', status: 'sent' });
  }

  lastTokenFor(to: string): string {
    const email = [...this.sent].reverse().find((m) => m.to === to);
    if (!email) throw new Error(`No email captured for ${to}`);
    const match = /token=([0-9a-f]+)/.exec(email.body);
    if (!match) {
      throw new Error(`No token found in captured email body: ${email.body}`);
    }
    return match[1]!;
  }
}

/**
 * Team invitation-by-email — the alternative to POST /organizations/me/members, which requires
 * the invited address to already have a KORVA account (USER_NOT_FOUND otherwise). See
 * InvitationsService's class doc for why the routes are implemented under
 * apps/api/src/identity/invitations/ rather than apps/api/src/organizations/invitations/ (a
 * file-ownership constraint, not a behavioral difference — routes are identical either way).
 */
describe('Organizations — team invitations (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  let emailProvider: CapturingEmailProvider;

  beforeAll(async () => {
    emailProvider = new CapturingEmailProvider();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EMAIL_PROVIDER)
      .useValue(emailProvider)
      .compile();

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

  it('full flow: invite -> accept as a brand-new user -> membership created with the invited role', async () => {
    const { accessToken, organization } = await registerOrgAndToken(
      'invite-owner-new@korva.test',
      'Invite New User Org',
    );
    const managerRoleId = await roleId(accessToken, organization.id, 'MANAGER');
    const inviteeEmail = 'invitee-new@korva.test';

    const inviteRes = await request(server)
      .post('/api/v1/organizations/me/invitations')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .send({ email: inviteeEmail, roleId: managerRoleId })
      .expect(201);
    expect(
      asSuccess<{ email: string; status: string }>(inviteRes.body).status,
    ).toBe('pending');

    const token = emailProvider.lastTokenFor(inviteeEmail);

    const acceptRes = await request(server)
      .post(`/api/v1/invitations/${token}/accept`)
      .send({ password: 'brandnewpassword123', firstName: 'New' })
      .expect(201);
    const accepted = asSuccess<{
      organizationId: string;
      membershipId: string;
      roleId: string;
      userId: string;
      createdNewUser: boolean;
    }>(acceptRes.body);
    expect(accepted.organizationId).toBe(organization.id);
    expect(accepted.roleId).toBe(managerRoleId);
    expect(accepted.createdNewUser).toBe(true);

    // The new account can now log in with the password it supplied at accept time.
    const loginRes = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: inviteeEmail, password: 'brandnewpassword123' })
      .expect(201);
    expect(asSuccess<{ user: { id: string } }>(loginRes.body).user.id).toBe(
      accepted.userId,
    );

    // The membership genuinely exists, with the invited role, in the org's member list.
    const membersRes = await request(server)
      .get('/api/v1/organizations/me/members')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .expect(200);
    const members = asSuccess<MembershipPayload[]>(membersRes.body);
    const newMember = members.find((m) => m.id === accepted.membershipId);
    expect(newMember).toBeDefined();
    expect(newMember?.status).toBe('active');

    // Re-accepting the same (now-consumed) token must fail.
    const reuseRes = await request(server)
      .post(`/api/v1/invitations/${token}/accept`)
      .send({ password: 'irrelevant12345' })
      .expect(401);
    expect(asError(reuseRes.body).code).toBe('INVALID_INVITATION_TOKEN');
  });

  it('invite -> accept as an already-existing user: no password required, membership attached to the existing account', async () => {
    const { accessToken, organization } = await registerOrgAndToken(
      'invite-owner-existing@korva.test',
      'Invite Existing User Org',
    );
    const managerRoleId = await roleId(accessToken, organization.id, 'MANAGER');
    const existingEmail = 'invitee-existing@korva.test';

    // The invited user already has a KORVA account (e.g. a member of a different org).
    const existingAuthRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email: existingEmail, password: 'alreadyhaveapassword' })
      .expect(201);
    const existingUserId = asSuccess<AuthPayload & { user: { id: string } }>(
      existingAuthRes.body,
    ).user.id;

    await request(server)
      .post('/api/v1/organizations/me/invitations')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .send({ email: existingEmail, roleId: managerRoleId })
      .expect(201);

    const token = emailProvider.lastTokenFor(existingEmail);

    // No password needed — the invitation token itself is proof of email ownership, same
    // posture as PasswordResetService's token-as-credential design.
    const acceptRes = await request(server)
      .post(`/api/v1/invitations/${token}/accept`)
      .send({})
      .expect(201);
    const accepted = asSuccess<{ userId: string; createdNewUser: boolean }>(
      acceptRes.body,
    );
    expect(accepted.userId).toBe(existingUserId);
    expect(accepted.createdNewUser).toBe(false);
  });

  it('rejects an expired invitation token with the same generic error as an invalid one', async () => {
    const { accessToken, organization } = await registerOrgAndToken(
      'invite-expired@korva.test',
      'Invite Expired Org',
    );
    const managerRoleId = await roleId(accessToken, organization.id, 'MANAGER');
    const inviteeEmail = 'invitee-expired@korva.test';

    await request(server)
      .post('/api/v1/organizations/me/invitations')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .send({ email: inviteeEmail, roleId: managerRoleId })
      .expect(201);
    const token = emailProvider.lastTokenFor(inviteeEmail);

    // Force it into the past, same technique as password-reset.e2e-spec.ts's expired-token test.
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await connection
      .collection('invitations')
      .updateOne(
        { tokenHash },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      );

    const res = await request(server)
      .post(`/api/v1/invitations/${token}/accept`)
      .send({ password: 'irrelevant12345' })
      .expect(401);
    expect(asError(res.body).code).toBe('INVALID_INVITATION_TOKEN');
  });

  it('a non-owner cannot invite above their own role rank, even with settings.manage permission', async () => {
    const { accessToken: ownerToken, organization } = await registerOrgAndToken(
      'invite-hierarchy-owner@korva.test',
      'Invite Hierarchy Org',
    );
    const ownerRoleId = await roleId(ownerToken, organization.id, 'OWNER');
    const adminRoleId = await roleId(ownerToken, organization.id, 'ADMIN');

    // Owner adds a second, pre-existing user as ADMIN (ADMIN shares OWNER's CORE_PERMISSIONS,
    // including settings.manage — the permission check alone would let this through; only the
    // rank check below should block it).
    const adminEmail = 'invite-hierarchy-admin@korva.test';
    const adminAuthRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email: adminEmail, password: 'password123' })
      .expect(201);
    const adminToken = asSuccess<AuthPayload>(adminAuthRes.body).accessToken;
    await request(server)
      .post('/api/v1/organizations/me/members')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Organization-Id', organization.id)
      .send({ email: adminEmail, roleId: adminRoleId })
      .expect(201);

    // The ADMIN tries to invite someone as OWNER — must be rejected on rank, not permission.
    const res = await request(server)
      .post('/api/v1/organizations/me/invitations')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Organization-Id', organization.id)
      .send({
        email: 'invite-hierarchy-target@korva.test',
        roleId: ownerRoleId,
      })
      .expect(403);
    expect(asError(res.body).code).toBe('ROLE_HIERARCHY_VIOLATION');
  });
});
