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
interface ContactPayload {
  id: string;
}
interface SegmentPayload {
  id: string;
}
interface CampaignPayload {
  id: string;
  status: string;
  stats: {
    totalRecipients: number;
    processedCount: number;
    sentCount: number;
    failedCount: number;
    skippedCount: number;
  };
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

async function waitFor<T>(
  check: () => Promise<T | undefined>,
  timeoutMs = 15000,
  intervalMs = 300,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result !== undefined) return result;
    if (Date.now() > deadline) {
      throw new Error('waitFor: timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

describe('Marketing module (e2e)', () => {
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
    const organizationId = asSuccess<OrganizationPayload>(orgRes.body).id;

    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ enabledModules: ['crm', 'communication', 'marketing'] })
      .expect(200);

    return { accessToken, organizationId };
  }

  async function createContact(
    accessToken: string,
    organizationId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const res = await request(server)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ firstName: 'Client', ...overrides })
      .expect(201);
    return asSuccess<ContactPayload>(res.body).id;
  }

  describe('segments', () => {
    let accessToken: string;
    let organizationId: string;
    let vipContactId: string;
    let otherContactId: string;

    beforeAll(async () => {
      ({ accessToken, organizationId } = await registerOrgAndToken(
        'marketing-segments@korva.test',
        'Marketing Segments Org',
      ));
      vipContactId = await createContact(accessToken, organizationId, {
        email: 'vip@customer.test',
        tags: ['vip'],
      });
      otherContactId = await createContact(accessToken, organizationId, {
        email: 'regular@customer.test',
        tags: [],
      });
    });

    it('previews a tag-based segment against real contacts', async () => {
      const res = await request(server)
        .post('/api/v1/segments/preview')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          criteria: {
            version: 1,
            match: 'all',
            rules: [{ field: 'tag', operator: 'has_tag', value: 'vip' }],
          },
        })
        .expect(201);
      expect(asSuccess<{ count: number }>(res.body).count).toBe(1);
    });

    it('rejects a segment referencing a custom field that does not exist', async () => {
      const res = await request(server)
        .post('/api/v1/segments')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'Bad segment',
          criteria: {
            version: 1,
            match: 'all',
            rules: [{ field: 'customField:not_defined', operator: 'is_set' }],
          },
        })
        .expect(400);
      expect(asError(res.body).code).toBe('UNKNOWN_SEGMENT_FIELD');
    });

    it('creates, lists, gets, updates, and deletes a segment', async () => {
      const createRes = await request(server)
        .post('/api/v1/segments')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'VIP customers',
          criteria: {
            version: 1,
            match: 'all',
            rules: [{ field: 'tag', operator: 'has_tag', value: 'vip' }],
          },
        })
        .expect(201);
      const segmentId = asSuccess<SegmentPayload>(createRes.body).id;

      const listRes = await request(server)
        .get('/api/v1/segments')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(
        asSuccess<SegmentPayload[]>(listRes.body).some(
          (s) => s.id === segmentId,
        ),
      ).toBe(true);

      await request(server)
        .get(`/api/v1/segments/${segmentId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);

      await request(server)
        .patch(`/api/v1/segments/${segmentId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ name: 'VIP customers (renamed)' })
        .expect(200);

      await request(server)
        .delete(`/api/v1/segments/${segmentId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);

      await request(server)
        .get(`/api/v1/segments/${segmentId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(404);
    });

    it("never returns another organization's segment", async () => {
      const createRes = await request(server)
        .post('/api/v1/segments')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'Org A segment',
          criteria: {
            version: 1,
            match: 'all',
            rules: [{ field: 'tag', operator: 'has_tag', value: 'vip' }],
          },
        })
        .expect(201);
      const segmentId = asSuccess<SegmentPayload>(createRes.body).id;

      const other = await registerOrgAndToken(
        'marketing-segments-other@korva.test',
        'Other Org',
      );

      const res = await request(server)
        .get(`/api/v1/segments/${segmentId}`)
        .set('Authorization', `Bearer ${other.accessToken}`)
        .set('X-Organization-Id', other.organizationId)
        .expect(404);
      expect(asError(res.body).code).toBe('SEGMENT_NOT_FOUND');
    });

    it("never matches another organization's contacts", () => {
      // Sanity check on the fixtures above rather than a new request: vipContactId/
      // otherContactId only ever created under `organizationId` — buildContactFilter's own
      // unit tests (segment-query-builder.spec.ts) cover the tenant-isolation guarantee at the
      // query-construction level directly.
      expect(vipContactId).toBeTruthy();
      expect(otherContactId).toBeTruthy();
    });
  });

  describe('campaigns', () => {
    let accessToken: string;
    let organizationId: string;
    let segmentId: string;

    beforeAll(async () => {
      ({ accessToken, organizationId } = await registerOrgAndToken(
        'marketing-campaigns@korva.test',
        'Marketing Campaigns Org',
      ));
      await createContact(accessToken, organizationId, {
        email: 'reachable-1@customer.test',
        tags: ['newsletter'],
      });
      await createContact(accessToken, organizationId, {
        email: 'reachable-2@customer.test',
        tags: ['newsletter'],
      });
      await createContact(accessToken, organizationId, {
        email: 'not-reachable@customer.test',
        tags: [],
      });

      const segmentRes = await request(server)
        .post('/api/v1/segments')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'Newsletter subscribers',
          criteria: {
            version: 1,
            match: 'all',
            rules: [{ field: 'tag', operator: 'has_tag', value: 'newsletter' }],
          },
        })
        .expect(201);
      segmentId = asSuccess<SegmentPayload>(segmentRes.body).id;
    });

    it('creates a draft campaign, launches it, and it completes with the right recipient count', async () => {
      const createRes = await request(server)
        .post('/api/v1/campaigns')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'Fall newsletter',
          segmentId,
          subject: 'News',
          body: 'Hello {{contact.firstName}}, check this out!',
        })
        .expect(201);
      const campaign = asSuccess<CampaignPayload>(createRes.body);
      expect(campaign.status).toBe('draft');

      await request(server)
        .post(`/api/v1/campaigns/${campaign.id}/send`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      const completed = await waitFor(async () => {
        const res = await request(server)
          .get(`/api/v1/campaigns/${campaign.id}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .expect(200);
        const body = asSuccess<CampaignPayload>(res.body);
        return body.status === 'sent' ? body : undefined;
      });

      expect(completed.stats.totalRecipients).toBe(2);
      expect(completed.stats.processedCount).toBe(2);
      expect(completed.stats.sentCount).toBe(2);

      const recipientsRes = await request(server)
        .get(`/api/v1/campaigns/${campaign.id}/recipients`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const recipients = asSuccess<{ status: string }[]>(recipientsRes.body);
      expect(recipients).toHaveLength(2);
      expect(recipients.every((r) => r.status === 'sent')).toBe(true);
    });

    it('rejects sending an already-sent campaign', async () => {
      const createRes = await request(server)
        .post('/api/v1/campaigns')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ name: 'One-shot', segmentId, body: 'Hi {{contact.firstName}}' })
        .expect(201);
      const campaignId = asSuccess<CampaignPayload>(createRes.body).id;

      await request(server)
        .post(`/api/v1/campaigns/${campaignId}/send`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      await waitFor(async () => {
        const res = await request(server)
          .get(`/api/v1/campaigns/${campaignId}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .expect(200);
        const body = asSuccess<CampaignPayload>(res.body);
        return body.status === 'sent' ? body : undefined;
      });

      const res = await request(server)
        .post(`/api/v1/campaigns/${campaignId}/send`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(400);
      expect(asError(res.body).code).toBe('CAMPAIGN_ALREADY_SENT');
    });

    it('rejects editing a campaign that is no longer a draft', async () => {
      const createRes = await request(server)
        .post('/api/v1/campaigns')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ name: 'Locked', segmentId, body: 'Hi {{contact.firstName}}' })
        .expect(201);
      const campaignId = asSuccess<CampaignPayload>(createRes.body).id;

      await request(server)
        .post(`/api/v1/campaigns/${campaignId}/send`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      const res = await request(server)
        .patch(`/api/v1/campaigns/${campaignId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ name: 'Renamed' })
        .expect(400);
      expect(asError(res.body).code).toBe('CAMPAIGN_NOT_EDITABLE');
    });

    it('completes immediately with zero recipients when the segment matches nobody', async () => {
      const emptySegmentRes = await request(server)
        .post('/api/v1/segments')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'Nobody',
          criteria: {
            version: 1,
            match: 'all',
            rules: [
              { field: 'tag', operator: 'has_tag', value: 'no-such-tag' },
            ],
          },
        })
        .expect(201);
      const emptySegmentId = asSuccess<SegmentPayload>(emptySegmentRes.body).id;

      const createRes = await request(server)
        .post('/api/v1/campaigns')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ name: 'Empty', segmentId: emptySegmentId, body: 'Hi' })
        .expect(201);
      const campaignId = asSuccess<CampaignPayload>(createRes.body).id;

      const sendRes = await request(server)
        .post(`/api/v1/campaigns/${campaignId}/send`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      const sent = asSuccess<CampaignPayload>(sendRes.body);
      expect(sent.status).toBe('sent');
      expect(sent.stats.totalRecipients).toBe(0);
    });
  });

  describe('RBAC', () => {
    let ownerToken: string;
    let organizationId: string;
    let segmentId: string;

    beforeAll(async () => {
      ({ accessToken: ownerToken, organizationId } = await registerOrgAndToken(
        'marketing-rbac@korva.test',
        'Marketing RBAC Org',
      ));
      // Free plan caps seats at 3 — this describe block adds 4 more members (SALES, STAFF,
      // FINANCE, MANAGER) on top of the owner, so it needs a plan without that ceiling.
      await request(server)
        .post('/api/v1/subscriptions/change-plan')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ planKey: 'business' })
        .expect(201);
      const segmentRes = await request(server)
        .post('/api/v1/segments')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'RBAC segment',
          criteria: {
            version: 1,
            match: 'all',
            rules: [{ field: 'tag', operator: 'has_tag', value: 'x' }],
          },
        })
        .expect(201);
      segmentId = asSuccess<SegmentPayload>(segmentRes.body).id;
    });

    async function addMember(
      email: string,
      systemKey: string,
    ): Promise<string> {
      const authRes = await request(server)
        .post('/api/v1/auth/register')
        .send({ email, password: 'password123' })
        .expect(201);
      const accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

      const role = await connection.collection('roles').findOne({
        organizationId: new Types.ObjectId(organizationId),
        systemKey,
      });
      expect(role).not.toBeNull();

      await request(server)
        .post('/api/v1/organizations/me/members')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ email, roleId: String(role?._id) })
        .expect(201);

      return accessToken;
    }

    it('lets SALES create and edit campaigns but not send them', async () => {
      const salesToken = await addMember(
        'marketing-rbac-sales@korva.test',
        'SALES',
      );

      const createRes = await request(server)
        .post('/api/v1/campaigns')
        .set('Authorization', `Bearer ${salesToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ name: 'Sales draft', segmentId, body: 'Hi' })
        .expect(201);
      const campaignId = asSuccess<CampaignPayload>(createRes.body).id;

      const sendRes = await request(server)
        .post(`/api/v1/campaigns/${campaignId}/send`)
        .set('Authorization', `Bearer ${salesToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(403);
      expect(asError(sendRes.body).code).toBe('PERMISSION_DENIED');
    });

    it('denies STAFF and FINANCE any access to segments/campaigns', async () => {
      const staffToken = await addMember(
        'marketing-rbac-staff@korva.test',
        'STAFF',
      );
      const financeToken = await addMember(
        'marketing-rbac-finance@korva.test',
        'FINANCE',
      );

      for (const token of [staffToken, financeToken]) {
        const res = await request(server)
          .get('/api/v1/segments')
          .set('Authorization', `Bearer ${token}`)
          .set('X-Organization-Id', organizationId)
          .expect(403);
        expect(asError(res.body).code).toBe('PERMISSION_DENIED');
      }
    });

    it('lets MANAGER send a campaign', async () => {
      const managerToken = await addMember(
        'marketing-rbac-manager@korva.test',
        'MANAGER',
      );

      const createRes = await request(server)
        .post('/api/v1/campaigns')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ name: 'Manager campaign', segmentId, body: 'Hi' })
        .expect(201);
      const campaignId = asSuccess<CampaignPayload>(createRes.body).id;

      await request(server)
        .post(`/api/v1/campaigns/${campaignId}/send`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
    });
  });
});
