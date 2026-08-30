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
  logo?: string;
  brandColor?: string;
  tagline?: string;
  heroImage?: string;
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

  it('accepts a valid hex brandColor and persists it through PATCH /organizations/me', async () => {
    const { accessToken, organization } = await registerOrgAndToken(
      'org-branding@korva.test',
      'Branding Org',
    );

    const patchRes = await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .send({
        brandColor: '#1a73e8',
        logo: 'https://cdn.korva.test/logos/branding-org.png',
        tagline: 'Le meilleur salon de la ville',
        heroImage: 'https://cdn.korva.test/hero/branding-org.png',
      })
      .expect(200);
    const patched = asSuccess<OrganizationPayload>(patchRes.body);
    expect(patched.brandColor).toBe('#1a73e8');
    expect(patched.logo).toBe('https://cdn.korva.test/logos/branding-org.png');
    expect(patched.tagline).toBe('Le meilleur salon de la ville');
    expect(patched.heroImage).toBe(
      'https://cdn.korva.test/hero/branding-org.png',
    );

    const meRes = await request(server)
      .get('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .expect(200);
    expect(asSuccess<OrganizationPayload>(meRes.body).brandColor).toBe(
      '#1a73e8',
    );
  });

  it('rejects a brandColor that is not a valid hex color', async () => {
    const { accessToken, organization } = await registerOrgAndToken(
      'org-branding-invalid@korva.test',
      'Branding Invalid Org',
    );

    const res = await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .send({ brandColor: 'not-a-color' })
      .expect(400);
    expect(asError(res.body).code).toBe('VALIDATION_ERROR');
  });

  it('accepts a valid storefrontSections array and persists it', async () => {
    const { accessToken, organization } = await registerOrgAndToken(
      'org-storefront-sections@korva.test',
      'Storefront Sections Org',
    );

    const patchRes = await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .send({ storefrontSections: ['catalog'] })
      .expect(200);
    expect(
      asSuccess<OrganizationPayload & { storefrontSections?: string[] }>(
        patchRes.body,
      ).storefrontSections,
    ).toEqual(['catalog']);
  });

  it('rejects a storefrontSections entry outside catalog/booking', async () => {
    const { accessToken, organization } = await registerOrgAndToken(
      'org-storefront-sections-invalid@korva.test',
      'Storefront Sections Invalid Org',
    );

    const res = await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .send({ storefrontSections: ['finance'] })
      .expect(400);
    expect(asError(res.body).code).toBe('VALIDATION_ERROR');
  });
});

interface RolePayload {
  id: string;
  name: string;
  systemKey?: string;
}
interface MembershipPayload {
  id: string;
  userId: string | { id: string; email: string };
  roleId: string | { id: string; systemKey?: string };
  status: string;
  defaultHourlyRate?: number;
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

  it('GET /organizations/me/invitations lists pending invitations and drops one once accepted', async () => {
    const { accessToken, organization } = await registerOrgAndToken(
      'invite-pending-owner@korva.test',
      'Invite Pending Org',
    );
    const managerRoleId = await roleId(accessToken, organization.id, 'MANAGER');
    const inviteeEmail = 'invite-pending-invitee@korva.test';

    await request(server)
      .post('/api/v1/organizations/me/invitations')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .send({ email: inviteeEmail, roleId: managerRoleId })
      .expect(201);

    const beforeAccept = await request(server)
      .get('/api/v1/organizations/me/invitations')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .expect(200);
    const pendingBefore = asSuccess<
      { email: string; status: string; tokenHash?: string }[]
    >(beforeAccept.body);
    expect(pendingBefore).toHaveLength(1);
    expect(pendingBefore[0]?.email).toBe(inviteeEmail);
    expect(pendingBefore[0]?.status).toBe('pending');
    // The schema marks tokenHash select:false — it must never reach an HTTP response.
    expect(pendingBefore[0]).not.toHaveProperty('tokenHash');

    const token = emailProvider.lastTokenFor(inviteeEmail);
    await request(server)
      .post(`/api/v1/invitations/${token}/accept`)
      .send({ password: 'brandnewpassword123' })
      .expect(201);

    const afterAccept = await request(server)
      .get('/api/v1/organizations/me/invitations')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .expect(200);
    expect(asSuccess<unknown[]>(afterAccept.body)).toHaveLength(0);
  });
});

/**
 * Member role change and removal — PATCH/DELETE /organizations/me/members/:id. Team management
 * was previously add-only (MembershipsService had no update/delete); these two routes close that
 * gap with the same hierarchy invariants addMember already enforces, extended with two checks
 * addMember doesn't need: the membership's CURRENT role must not outrank the actor either (an
 * ADMIN can't touch an OWNER's role at all), and an organization's last active OWNER can never be
 * demoted or removed.
 */
describe('Organizations — member role change and removal (e2e)', () => {
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

  /** Registers a second user and adds them to the org via the existing addMember route
   *  (POST /organizations/me/members — requires the invited email to already have an account,
   *  which this always satisfies). Returns the new membership's id and the member's own token. */
  async function addMemberWithRole(
    ownerToken: string,
    organizationId: string,
    memberRoleId: string,
    email: string,
  ) {
    const memberAuthRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email, password: 'password123' })
      .expect(201);
    const memberToken = asSuccess<AuthPayload>(memberAuthRes.body).accessToken;

    const addRes = await request(server)
      .post('/api/v1/organizations/me/members')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ email, roleId: memberRoleId })
      .expect(201);
    const membershipId = asSuccess<MembershipPayload>(addRes.body).id;

    return { membershipId, memberToken };
  }

  it('an OWNER can change a member from STAFF to MANAGER', async () => {
    const { accessToken, organization } = await registerOrgAndToken(
      'role-change-owner@korva.test',
      'Role Change Org',
    );
    const staffRoleId = await roleId(accessToken, organization.id, 'STAFF');
    const managerRoleId = await roleId(accessToken, organization.id, 'MANAGER');
    const { membershipId } = await addMemberWithRole(
      accessToken,
      organization.id,
      staffRoleId,
      'role-change-member@korva.test',
    );

    const res = await request(server)
      .patch(`/api/v1/organizations/me/members/${membershipId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .send({ roleId: managerRoleId })
      .expect(200);
    const updated = asSuccess<MembershipPayload>(res.body);
    const updatedRoleId =
      typeof updated.roleId === 'string' ? updated.roleId : updated.roleId.id;
    expect(updatedRoleId).toBe(managerRoleId);
  });

  it('an ADMIN cannot promote a member to OWNER (role-hierarchy violation, same as addMember)', async () => {
    const { accessToken, organization } = await registerOrgAndToken(
      'role-change-owner2@korva.test',
      'Role Change Org 2',
    );
    const adminRoleId = await roleId(accessToken, organization.id, 'ADMIN');
    const staffRoleId = await roleId(accessToken, organization.id, 'STAFF');
    const ownerRoleId = await roleId(accessToken, organization.id, 'OWNER');

    const { memberToken: adminToken } = await addMemberWithRole(
      accessToken,
      organization.id,
      adminRoleId,
      'role-change-admin@korva.test',
    );
    const { membershipId: staffMembershipId } = await addMemberWithRole(
      accessToken,
      organization.id,
      staffRoleId,
      'role-change-staff@korva.test',
    );

    const res = await request(server)
      .patch(`/api/v1/organizations/me/members/${staffMembershipId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Organization-Id', organization.id)
      .send({ roleId: ownerRoleId })
      .expect(403);
    expect(asError(res.body).code).toBe('ROLE_HIERARCHY_VIOLATION');
  });

  it("an ADMIN cannot change an OWNER's role at all, even to a lower one (current-role hierarchy check)", async () => {
    const { accessToken, organization } = await registerOrgAndToken(
      'role-change-owner3@korva.test',
      'Role Change Org 3',
    );
    const adminRoleId = await roleId(accessToken, organization.id, 'ADMIN');
    const staffRoleId = await roleId(accessToken, organization.id, 'STAFF');

    const { memberToken: adminToken } = await addMemberWithRole(
      accessToken,
      organization.id,
      adminRoleId,
      'role-change-admin3@korva.test',
    );

    // The org creator's own membership is OWNER — find it via the members list.
    const membersRes = await request(server)
      .get('/api/v1/organizations/me/members')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .expect(200);
    const ownerMembership = asSuccess<MembershipPayload[]>(
      membersRes.body,
    ).find((m) =>
      typeof m.userId === 'string'
        ? false
        : m.userId.email === 'role-change-owner3@korva.test',
    );
    expect(ownerMembership).toBeDefined();

    const res = await request(server)
      .patch(`/api/v1/organizations/me/members/${ownerMembership!.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Organization-Id', organization.id)
      .send({ roleId: staffRoleId })
      .expect(403);
    expect(asError(res.body).code).toBe('ROLE_HIERARCHY_VIOLATION');
  });

  it("cannot demote an organization's last active OWNER", async () => {
    const { accessToken, organization } = await registerOrgAndToken(
      'role-change-owner4@korva.test',
      'Role Change Org 4',
    );
    const staffRoleId = await roleId(accessToken, organization.id, 'STAFF');

    const membersRes = await request(server)
      .get('/api/v1/organizations/me/members')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .expect(200);
    const ownerMembership = asSuccess<MembershipPayload[]>(membersRes.body)[0]!;

    const res = await request(server)
      .patch(`/api/v1/organizations/me/members/${ownerMembership.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .send({ roleId: staffRoleId })
      .expect(403);
    expect(asError(res.body).code).toBe('CANNOT_DEMOTE_LAST_OWNER');
  });

  it('an OWNER can remove a member, which suspends (not deletes) the membership', async () => {
    const { accessToken, organization } = await registerOrgAndToken(
      'remove-owner@korva.test',
      'Remove Member Org',
    );
    const staffRoleId = await roleId(accessToken, organization.id, 'STAFF');
    const { membershipId } = await addMemberWithRole(
      accessToken,
      organization.id,
      staffRoleId,
      'remove-member@korva.test',
    );

    await request(server)
      .delete(`/api/v1/organizations/me/members/${membershipId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .expect(200);

    const membersRes = await request(server)
      .get('/api/v1/organizations/me/members')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .expect(200);
    const removed = asSuccess<MembershipPayload[]>(membersRes.body).find(
      (m) => m.id === membershipId,
    );
    expect(removed?.status).toBe('suspended');
  });

  it('a removed member loses access to the organization (their token can no longer resolve tenant context)', async () => {
    const { accessToken, organization } = await registerOrgAndToken(
      'remove-owner2@korva.test',
      'Remove Access Org',
    );
    const staffRoleId = await roleId(accessToken, organization.id, 'STAFF');
    const { membershipId, memberToken } = await addMemberWithRole(
      accessToken,
      organization.id,
      staffRoleId,
      'remove-member2@korva.test',
    );

    await request(server)
      .delete(`/api/v1/organizations/me/members/${membershipId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .expect(200);

    const res = await request(server)
      .get('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${memberToken}`)
      .set('X-Organization-Id', organization.id)
      .expect(403);
    expect(asError(res.body).code).toBe('ORGANIZATION_ACCESS_DENIED');
  });

  it('removing a co-owner is allowed while a second owner remains, leaving exactly one active owner — who is then only protected by CANNOT_REMOVE_SELF, since only an owner can ever act on an owner', async () => {
    const { accessToken, organization } = await registerOrgAndToken(
      'remove-owner3@korva.test',
      'Remove Last Owner Org',
    );
    const membersRes = await request(server)
      .get('/api/v1/organizations/me/members')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .expect(200);
    const firstOwnerMembership = asSuccess<MembershipPayload[]>(
      membersRes.body,
    )[0]!;

    const ownerRoleId = await roleId(accessToken, organization.id, 'OWNER');
    const { membershipId: secondOwnerMembershipId } = await addMemberWithRole(
      accessToken,
      organization.id,
      ownerRoleId,
      'remove-owner3b@korva.test',
    );

    // Two active owners exist now — removing one is allowed (leaves exactly one, not zero).
    await request(server)
      .delete(`/api/v1/organizations/me/members/${secondOwnerMembershipId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .expect(200);

    // Only the remaining owner themselves could pass the hierarchy check against their own
    // OWNER-ranked membership now — making this a self-removal attempt, correctly rejected.
    const res = await request(server)
      .delete(`/api/v1/organizations/me/members/${firstOwnerMembership.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .expect(403);
    expect(asError(res.body).code).toBe('CANNOT_REMOVE_SELF');
  });

  it('cannot remove your own membership', async () => {
    const { accessToken, organization } = await registerOrgAndToken(
      'remove-self@korva.test',
      'Remove Self Org',
    );
    const adminRoleId = await roleId(accessToken, organization.id, 'ADMIN');
    const { membershipId: adminMembershipId, memberToken: adminToken } =
      await addMemberWithRole(
        accessToken,
        organization.id,
        adminRoleId,
        'remove-self-admin@korva.test',
      );

    const res = await request(server)
      .delete(`/api/v1/organizations/me/members/${adminMembershipId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Organization-Id', organization.id)
      .expect(403);
    expect(asError(res.body).code).toBe('CANNOT_REMOVE_SELF');
  });

  it('an ADMIN cannot remove an OWNER (role-hierarchy violation)', async () => {
    const { accessToken, organization } = await registerOrgAndToken(
      'remove-hierarchy-owner@korva.test',
      'Remove Hierarchy Org',
    );
    const adminRoleId = await roleId(accessToken, organization.id, 'ADMIN');
    const { memberToken: adminToken } = await addMemberWithRole(
      accessToken,
      organization.id,
      adminRoleId,
      'remove-hierarchy-admin@korva.test',
    );

    const membersRes = await request(server)
      .get('/api/v1/organizations/me/members')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .expect(200);
    const ownerMembership = asSuccess<MembershipPayload[]>(
      membersRes.body,
    ).find((m) =>
      typeof m.userId === 'string'
        ? false
        : m.userId.email === 'remove-hierarchy-owner@korva.test',
    )!;

    const res = await request(server)
      .delete(`/api/v1/organizations/me/members/${ownerMembership.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Organization-Id', organization.id)
      .expect(403);
    expect(asError(res.body).code).toBe('ROLE_HIERARCHY_VIOLATION');
  });

  it("propagates a cross-org 404 rather than modifying another org's membership", async () => {
    const { accessToken: ownerAToken, organization: orgA } =
      await registerOrgAndToken('cross-org-a@korva.test', 'Cross Org A');
    const { accessToken: ownerBToken, organization: orgB } =
      await registerOrgAndToken('cross-org-b@korva.test', 'Cross Org B');
    const staffRoleIdA = await roleId(ownerAToken, orgA.id, 'STAFF');
    const { membershipId } = await addMemberWithRole(
      ownerAToken,
      orgA.id,
      staffRoleIdA,
      'cross-org-member@korva.test',
    );

    // orgB's own owner (a real, active member of orgB — TenantGuard resolves fine) tries to
    // reach orgA's membership by id.
    const res = await request(server)
      .delete(`/api/v1/organizations/me/members/${membershipId}`)
      .set('Authorization', `Bearer ${ownerBToken}`)
      .set('X-Organization-Id', orgB.id)
      .expect(404);
    expect(asError(res.body).code).toBe('MEMBERSHIP_NOT_FOUND');
  });

  /**
   * PATCH /organizations/me/members/:id/rate — pre-fills TimeEntry.hourlyRate for a staff
   * member (see time-entries.e2e-spec.ts's rate-resolution coverage). Unlike role changes, this
   * carries no privilege-hierarchy invariant: any settings.manage holder can set any member's
   * rate, including their own or an OWNER's.
   */
  it("an OWNER can set a member's default hourly rate", async () => {
    const { accessToken, organization } = await registerOrgAndToken(
      'member-rate-owner@korva.test',
      'Member Rate Org',
    );
    const staffRoleId = await roleId(accessToken, organization.id, 'STAFF');
    const { membershipId } = await addMemberWithRole(
      accessToken,
      organization.id,
      staffRoleId,
      'member-rate-staff@korva.test',
    );

    const res = await request(server)
      .patch(`/api/v1/organizations/me/members/${membershipId}/rate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .send({ defaultHourlyRate: 85 })
      .expect(200);
    expect(asSuccess<MembershipPayload>(res.body).defaultHourlyRate).toBe(85);
  });

  it('rejects a non-positive default hourly rate', async () => {
    const { accessToken, organization } = await registerOrgAndToken(
      'member-rate-invalid-owner@korva.test',
      'Member Rate Invalid Org',
    );
    const staffRoleId = await roleId(accessToken, organization.id, 'STAFF');
    const { membershipId } = await addMemberWithRole(
      accessToken,
      organization.id,
      staffRoleId,
      'member-rate-invalid-staff@korva.test',
    );

    const res = await request(server)
      .patch(`/api/v1/organizations/me/members/${membershipId}/rate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .send({ defaultHourlyRate: 0 })
      .expect(400);
    expect(asError(res.body).code).toBe('VALIDATION_ERROR');
  });

  it('404s setting a rate on an unknown membership id', async () => {
    const { accessToken, organization } = await registerOrgAndToken(
      'member-rate-missing-owner@korva.test',
      'Member Rate Missing Org',
    );

    const res = await request(server)
      .patch('/api/v1/organizations/me/members/000000000000000000000000/rate')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .send({ defaultHourlyRate: 50 })
      .expect(404);
    expect(asError(res.body).code).toBe('MEMBERSHIP_NOT_FOUND');
  });

  it('denies a STAFF member (no settings.manage) from setting a rate', async () => {
    const { accessToken, organization } = await registerOrgAndToken(
      'member-rate-rbac-owner@korva.test',
      'Member Rate RBAC Org',
    );
    const staffRoleId = await roleId(accessToken, organization.id, 'STAFF');
    const { membershipId, memberToken: staffToken } = await addMemberWithRole(
      accessToken,
      organization.id,
      staffRoleId,
      'member-rate-rbac-staff@korva.test',
    );

    const res = await request(server)
      .patch(`/api/v1/organizations/me/members/${membershipId}/rate`)
      .set('Authorization', `Bearer ${staffToken}`)
      .set('X-Organization-Id', organization.id)
      .send({ defaultHourlyRate: 50 })
      .expect(403);
    expect(asError(res.body).code).toBe('PERMISSION_DENIED');
  });
});
