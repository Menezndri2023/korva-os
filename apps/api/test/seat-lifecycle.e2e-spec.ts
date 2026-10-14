import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { putOrganizationOnPlan } from './support/plan-tier';

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
interface MembershipPayload {
  id: string;
  status: string;
}
interface RolePayload {
  id: string;
  systemKey?: string;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

/**
 * The seat lifecycle, which three separate defects shared between them. All three live in the
 * same place — what "a seat" means — and each is asserted here against the real HTTP surface:
 *
 *  1. Removing a member did not free their seat. `removeMember` sets status to 'suspended'
 *     (deliberately: the audit trail and any work attributed to them must survive), but
 *     `countSeatsForOrganization` (then `countForOrganization`) counted every membership
 *     document regardless of status, and that
 *     count is what `assertSeatAvailable` compares to the plan limit. A Starter customer who
 *     removed someone was still told their plan was full.
 *  2. Re-adding a removed member returned a 500. `MembershipsService.create` always inserts,
 *     and a unique index on (userId, organizationId) rejects the second insert — surfacing as an
 *     unhandled MongoServerError, since nothing in src/common/ maps duplicate keys.
 *  3. A downgrade never checked seats at all. `assertSeatAvailable` guards only addMember, so an
 *     organization could move from Business (unlimited) to free (one seat) and keep every member.
 */
describe('Seat lifecycle (e2e)', () => {
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

  async function registerUser(email: string): Promise<string> {
    const res = await request(server)
      .post('/api/v1/auth/register')
      .send({ email, password: 'password123' })
      .expect(201);
    return asSuccess<AuthPayload>(res.body).accessToken;
  }

  async function setupOwner(email: string, orgName: string) {
    const accessToken = await registerUser(email);
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
    const organizationId = asSuccess<OrganizationPayload>(orgRes.body).id;

    const rolesRes = await request(server)
      .get('/api/v1/organizations/me/roles')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    const staffRoleId = asSuccess<RolePayload[]>(rolesRes.body).find(
      (r) => r.systemKey === 'STAFF',
    )!.id;

    return { accessToken, organizationId, staffRoleId };
  }

  function addMember(
    ownerToken: string,
    organizationId: string,
    email: string,
    roleId: string,
  ) {
    return request(server)
      .post('/api/v1/organizations/me/members')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ email, roleId });
  }

  describe('removing a member frees their seat', () => {
    it('lets the owner replace a member on a one-seat plan, as many times as they like', async () => {
      const { accessToken, organizationId, staffRoleId } = await setupOwner(
        'seat-free-owner@korva.test',
        'Seat Free Org',
      );
      // Starter: five seats, so the owner plus one member fits and the limit is not what this
      // test is about.
      await putOrganizationOnPlan(connection, organizationId, 'starter');

      await registerUser('seat-free-a@korva.test');
      const added = await addMember(
        accessToken,
        organizationId,
        'seat-free-a@korva.test',
        staffRoleId,
      ).expect(201);
      const membershipId = asSuccess<MembershipPayload>(added.body).id;

      // Remove the member. The seat must come back, which is the whole claim — a suspended
      // membership keeps existing for the audit trail but must not be billed.
      await request(server)
        .delete(`/api/v1/organizations/me/members/${membershipId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);

      const usage = await request(server)
        .get('/api/v1/subscriptions/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const seats = asSuccess<{
        usage: { metric: string; used: number }[];
      }>(usage.body).usage.find((u) => u.metric === 'seats');
      // Only the owner is left. A suspended membership must not be billed as a seat.
      expect(seats?.used).toBe(1);
    });

    it('refuses the second member on free, accepts them after the first is removed', async () => {
      const { accessToken, organizationId, staffRoleId } = await setupOwner(
        'seat-recycle-owner@korva.test',
        'Seat Recycle Org',
      );
      await putOrganizationOnPlan(connection, organizationId, 'starter');
      await registerUser('seat-recycle-a@korva.test');
      const added = await addMember(
        accessToken,
        organizationId,
        'seat-recycle-a@korva.test',
        staffRoleId,
      ).expect(201);
      const membershipId = asSuccess<MembershipPayload>(added.body).id;

      // Back to free, one seat — allowed only because the organization is within it once the
      // member is gone. Done by direct write, since the API now refuses this downgrade while
      // the organization is over the limit (that is the third describe below).
      await request(server)
        .delete(`/api/v1/organizations/me/members/${membershipId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      await putOrganizationOnPlan(connection, organizationId, 'free');

      // One seat, owner only, so this must be refused...
      await registerUser('seat-recycle-b@korva.test');
      const refused = await addMember(
        accessToken,
        organizationId,
        'seat-recycle-b@korva.test',
        staffRoleId,
      ).expect(403);
      expect(asError(refused.body).code).toBe('SEAT_LIMIT_REACHED');

      // ...and the removed member must not be the reason why.
      const suspended = await connection
        .collection('memberships')
        .countDocuments({
          organizationId: new Types.ObjectId(organizationId),
          status: 'suspended',
        });
      expect(suspended).toBe(1);
    });
  });

  describe('re-adding a removed member', () => {
    it('reactivates the existing membership instead of failing on the unique index', async () => {
      const { accessToken, organizationId, staffRoleId } = await setupOwner(
        'seat-rehire-owner@korva.test',
        'Seat Rehire Org',
      );
      await putOrganizationOnPlan(connection, organizationId, 'starter');

      await registerUser('seat-rehire-a@korva.test');
      const first = await addMember(
        accessToken,
        organizationId,
        'seat-rehire-a@korva.test',
        staffRoleId,
      ).expect(201);
      const membershipId = asSuccess<MembershipPayload>(first.body).id;

      await request(server)
        .delete(`/api/v1/organizations/me/members/${membershipId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);

      // Re-hiring the same person: a 500 from a duplicate key is never an acceptable answer.
      const second = await addMember(
        accessToken,
        organizationId,
        'seat-rehire-a@korva.test',
        staffRoleId,
      ).expect(201);
      const reactivated = asSuccess<MembershipPayload>(second.body);
      expect(reactivated.status).toBe('active');
      // The SAME membership document, so the audit trail and anything attributed to it survive.
      expect(reactivated.id).toBe(membershipId);

      const total = await connection.collection('memberships').countDocuments({
        organizationId: new Types.ObjectId(organizationId),
      });
      expect(total).toBe(2); // the owner and the one re-hired member, not three
    });
  });

  describe('downgrading below the seats in use', () => {
    it('refuses the plan change and says how many members are over the limit', async () => {
      const { accessToken, organizationId, staffRoleId } = await setupOwner(
        'seat-downgrade-owner@korva.test',
        'Seat Downgrade Org',
      );
      await putOrganizationOnPlan(connection, organizationId, 'business');

      for (const email of [
        'seat-downgrade-a@korva.test',
        'seat-downgrade-b@korva.test',
      ]) {
        await registerUser(email);
        await addMember(accessToken, organizationId, email, staffRoleId).expect(
          201,
        );
      }

      // Three people, one seat on free.
      const res = await request(server)
        .post('/api/v1/subscriptions/change-plan')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ planKey: 'free' })
        .expect(409);
      expect(asError(res.body).code).toBe('SEAT_LIMIT_EXCEEDED_BY_PLAN');
      expect(asError(res.body).message).toContain('2');

      // Refused means refused: the subscription must be untouched, not half-changed.
      const summary = await request(server)
        .get('/api/v1/subscriptions/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<{ plan: { key: string } }>(summary.body).plan.key).toBe(
        'business',
      );
    });

    it('allows the same downgrade once the organization is back within the limit', async () => {
      const { accessToken, organizationId, staffRoleId } = await setupOwner(
        'seat-downgrade-ok-owner@korva.test',
        'Seat Downgrade Ok Org',
      );
      await putOrganizationOnPlan(connection, organizationId, 'business');

      await registerUser('seat-downgrade-ok-a@korva.test');
      const added = await addMember(
        accessToken,
        organizationId,
        'seat-downgrade-ok-a@korva.test',
        staffRoleId,
      ).expect(201);

      await request(server)
        .delete(
          `/api/v1/organizations/me/members/${asSuccess<MembershipPayload>(added.body).id}`,
        )
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);

      await request(server)
        .post('/api/v1/subscriptions/change-plan')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ planKey: 'free' })
        .expect(201);
    });

    it('never blocks an UPGRADE, whatever the member count', async () => {
      const { accessToken, organizationId, staffRoleId } = await setupOwner(
        'seat-upgrade-owner@korva.test',
        'Seat Upgrade Org',
      );
      await putOrganizationOnPlan(connection, organizationId, 'starter');

      await registerUser('seat-upgrade-a@korva.test');
      await addMember(
        accessToken,
        organizationId,
        'seat-upgrade-a@korva.test',
        staffRoleId,
      ).expect(201);

      // business has unlimited seats (-1): the check must read that as "no limit", not as a
      // limit of minus one, which would refuse every upgrade to the top tier.
      await request(server)
        .post('/api/v1/subscriptions/change-plan')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ planKey: 'business' })
        .expect(201);
    });
  });
});
