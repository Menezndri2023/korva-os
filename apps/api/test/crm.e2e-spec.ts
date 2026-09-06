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
  firstName?: string;
  email?: string;
  phone?: string;
  tags: string[];
  customFields: Record<string, unknown>;
}
interface PipelineStagePayload {
  id: string;
  name: string;
}
interface PipelinePayload {
  id: string;
  stages: PipelineStagePayload[];
}
interface LeadPayload {
  id: string;
  status: string;
  contactId: string;
}
interface DealPayload {
  id: string;
  status: string;
  stageId: string;
  contactId: string;
  leadId?: string;
  lossReason?: string;
}
interface TaskPayload {
  id: string;
  entity?: string;
  entityId?: string;
}
interface CustomerAuthPayload {
  accessToken: string;
  customer: { id: string; email: string };
}
interface DuplicateGroupPayload {
  field: 'email' | 'phone';
  value: string;
  contacts: ContactPayload[];
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

describe('CRM module (e2e)', () => {
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
    // time (including the contacts text index search tests rely on) — rebuild
    // them explicitly rather than racing autoIndex with a timer.
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
        type: 'service',
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
      .send({ enabledModules: ['crm'] })
      .expect(200);

    return { accessToken, organizationId };
  }

  describe('custom fields drive contact validation', () => {
    let accessToken: string;
    let organizationId: string;

    beforeAll(async () => {
      ({ accessToken, organizationId } = await registerOrgAndToken(
        'cf-owner@korva.test',
        'Custom Fields Org',
      ));
      await request(server)
        .post('/api/v1/custom-fields')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          entity: 'contacts',
          key: 'budget',
          label: 'Budget',
          type: 'number',
          required: false,
        })
        .expect(201);
    });

    it('rejects an unknown custom field key', async () => {
      const res = await request(server)
        .post('/api/v1/contacts')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ firstName: 'Bad', customFields: { nope: 1 } })
        .expect(400);
      expect(asError(res.body).code).toBe('UNKNOWN_CUSTOM_FIELD');
    });

    it('rejects a type mismatch on a known custom field', async () => {
      const res = await request(server)
        .post('/api/v1/contacts')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ firstName: 'Bad', customFields: { budget: 'not-a-number' } })
        .expect(400);
      expect(asError(res.body).code).toBe('CUSTOM_FIELD_TYPE_MISMATCH');
    });

    it('accepts a well-typed custom field value', async () => {
      const res = await request(server)
        .post('/api/v1/contacts')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ firstName: 'Good', customFields: { budget: 4200 } })
        .expect(201);
      expect(
        asSuccess<{ customFields: { budget: number } }>(res.body).customFields
          .budget,
      ).toBe(4200);
    });
  });

  describe('contacts CRUD, search and tags', () => {
    let accessToken: string;
    let organizationId: string;
    let contactId: string;

    beforeAll(async () => {
      ({ accessToken, organizationId } = await registerOrgAndToken(
        'contacts-owner@korva.test',
        'Contacts Org',
      ));
      const res = await request(server)
        .post('/api/v1/contacts')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          firstName: 'Jean',
          lastName: 'Dupont',
          email: 'jean@example.com',
          tags: ['vip'],
        })
        .expect(201);
      contactId = asSuccess<ContactPayload>(res.body).id;
    });

    it('finds the contact by full-text search', async () => {
      const res = await request(server)
        .get('/api/v1/contacts?search=Jean')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const contacts = asSuccess<ContactPayload[]>(res.body);
      expect(contacts.map((c) => c.id)).toContain(contactId);
    });

    it('filters contacts by tag', async () => {
      const res = await request(server)
        .get('/api/v1/contacts?tag=vip')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const contacts = asSuccess<ContactPayload[]>(res.body);
      expect(contacts).toHaveLength(1);
    });

    it('updates and then deletes the contact', async () => {
      await request(server)
        .patch(`/api/v1/contacts/${contactId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ company: 'Acme' })
        .expect(200);

      await request(server)
        .delete(`/api/v1/contacts/${contactId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);

      await request(server)
        .get(`/api/v1/contacts/${contactId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(404);
    });
  });

  describe('leads', () => {
    let accessToken: string;
    let organizationId: string;
    let contactId: string;

    beforeAll(async () => {
      ({ accessToken, organizationId } = await registerOrgAndToken(
        'leads-owner@korva.test',
        'Leads Org',
      ));

      const contactRes = await request(server)
        .post('/api/v1/contacts')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ firstName: 'Prospect' })
        .expect(201);
      contactId = asSuccess<ContactPayload>(contactRes.body).id;
    });

    it('rejects a lead referencing a contact that does not exist', async () => {
      await request(server)
        .post('/api/v1/leads')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ contactId: '000000000000000000000000' })
        .expect(404);
    });

    it('creates a lead with the default "new" status and updates its status directly', async () => {
      const createRes = await request(server)
        .post('/api/v1/leads')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ contactId, source: 'site web' })
        .expect(201);
      const lead = asSuccess<LeadPayload>(createRes.body);
      expect(lead.status).toBe('new');

      const updateRes = await request(server)
        .patch(`/api/v1/leads/${lead.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ status: 'qualified' })
        .expect(200);
      expect(asSuccess<LeadPayload>(updateRes.body).status).toBe('qualified');
    });

    it('filters leads by contactId', async () => {
      const otherContactRes = await request(server)
        .post('/api/v1/contacts')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ firstName: 'Other Prospect' })
        .expect(201);
      const otherContactId = asSuccess<ContactPayload>(otherContactRes.body).id;

      const ownLeadRes = await request(server)
        .post('/api/v1/leads')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ contactId })
        .expect(201);
      const ownLeadId = asSuccess<LeadPayload>(ownLeadRes.body).id;

      await request(server)
        .post('/api/v1/leads')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ contactId: otherContactId })
        .expect(201);

      const filteredRes = await request(server)
        .get(`/api/v1/leads?contactId=${contactId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const filtered = asSuccess<LeadPayload[]>(filteredRes.body);
      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered.every((lead) => lead.contactId === contactId)).toBe(true);
      expect(filtered.map((lead) => lead.id)).toContain(ownLeadId);
    });
  });

  describe('deals and lead conversion', () => {
    let accessToken: string;
    let organizationId: string;
    let contactId: string;
    let pipelineId: string;
    let stageAId: string;
    let stageBId: string;

    beforeAll(async () => {
      ({ accessToken, organizationId } = await registerOrgAndToken(
        'deals-owner@korva.test',
        'Deals Org',
      ));

      const contactRes = await request(server)
        .post('/api/v1/contacts')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ firstName: 'Prospect' })
        .expect(201);
      contactId = asSuccess<ContactPayload>(contactRes.body).id;

      const pipelineRes = await request(server)
        .post('/api/v1/pipelines')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'Sales',
          isDefault: true,
          stages: [
            { name: 'New', order: 0 },
            { name: 'Won', order: 1 },
          ],
        })
        .expect(201);
      const pipeline = asSuccess<PipelinePayload>(pipelineRes.body);
      pipelineId = pipeline.id;
      stageAId = pipeline.stages[0]!.id;
      stageBId = pipeline.stages[1]!.id;
    });

    it('rejects a deal referencing a contact that does not exist', async () => {
      await request(server)
        .post('/api/v1/deals')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId: '000000000000000000000000',
          pipelineId,
          stageId: stageAId,
        })
        .expect(404);
    });

    it('rejects a deal referencing a stage that does not exist in the pipeline', async () => {
      await request(server)
        .post('/api/v1/deals')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ contactId, pipelineId, stageId: '000000000000000000000000' })
        .expect(404);
    });

    it('creates a deal open, moves its stage, then wins it', async () => {
      const createRes = await request(server)
        .post('/api/v1/deals')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          pipelineId,
          stageId: stageAId,
          estimatedValue: 1000,
        })
        .expect(201);
      const deal = asSuccess<DealPayload>(createRes.body);
      expect(deal.status).toBe('open');

      const moveRes = await request(server)
        .post(`/api/v1/deals/${deal.id}/move-stage`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ stageId: stageBId })
        .expect(201);
      expect(asSuccess<DealPayload>(moveRes.body).stageId).toBe(stageBId);

      const winRes = await request(server)
        .post(`/api/v1/deals/${deal.id}/win`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      expect(asSuccess<DealPayload>(winRes.body).status).toBe('won');

      // A won deal is closed: cannot move stage or win again until reopened.
      await request(server)
        .post(`/api/v1/deals/${deal.id}/move-stage`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ stageId: stageAId })
        .expect(400);
      await request(server)
        .post(`/api/v1/deals/${deal.id}/win`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(400);

      const reopenRes = await request(server)
        .post(`/api/v1/deals/${deal.id}/reopen`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      expect(asSuccess<DealPayload>(reopenRes.body).status).toBe('open');
    });

    it('loses a deal with a reason, and a closed deal cannot be reopened twice', async () => {
      const createRes = await request(server)
        .post('/api/v1/deals')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ contactId, pipelineId, stageId: stageAId })
        .expect(201);
      const dealId = asSuccess<DealPayload>(createRes.body).id;

      const loseRes = await request(server)
        .post(`/api/v1/deals/${dealId}/lose`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ lossReason: 'Budget insuffisant' })
        .expect(201);
      const lost = asSuccess<DealPayload>(loseRes.body);
      expect(lost.status).toBe('lost');
      expect(lost.lossReason).toBe('Budget insuffisant');

      await request(server)
        .post(`/api/v1/deals/${dealId}/reopen`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      await request(server)
        .post(`/api/v1/deals/${dealId}/reopen`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(400);
    });

    it('converts a lead into a deal, and rejects converting it twice', async () => {
      const leadRes = await request(server)
        .post('/api/v1/leads')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ contactId })
        .expect(201);
      const leadId = asSuccess<LeadPayload>(leadRes.body).id;

      const convertRes = await request(server)
        .post(`/api/v1/leads/${leadId}/convert`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ pipelineId, stageId: stageAId, estimatedValue: 500 })
        .expect(201);
      const { lead, deal } = asSuccess<{
        lead: LeadPayload;
        deal: DealPayload;
      }>(convertRes.body);
      expect(lead.status).toBe('converted');
      expect(deal.leadId).toBe(leadId);
      expect(deal.status).toBe('open');

      await request(server)
        .post(`/api/v1/leads/${leadId}/convert`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ pipelineId, stageId: stageAId })
        .expect(400);

      const dealsForLeadRes = await request(server)
        .get(`/api/v1/deals?leadId=${leadId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<DealPayload[]>(dealsForLeadRes.body)).toHaveLength(1);
    });
  });

  describe('tenant isolation for CRM resources', () => {
    it('denies a user from another organization listing contacts via a foreign org id', async () => {
      const a = await registerOrgAndToken('crm-iso-a@korva.test', 'CRM Iso A');
      const b = await registerOrgAndToken('crm-iso-b@korva.test', 'CRM Iso B');

      await request(server)
        .post('/api/v1/contacts')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Organization-Id', a.organizationId)
        .send({ firstName: 'Secret' })
        .expect(201);

      const res = await request(server)
        .get('/api/v1/contacts')
        .set('Authorization', `Bearer ${b.accessToken}`)
        .set('X-Organization-Id', a.organizationId)
        .expect(403);
      expect(asError(res.body).code).toBe('ORGANIZATION_ACCESS_DENIED');

      const ownRes = await request(server)
        .get('/api/v1/contacts')
        .set('Authorization', `Bearer ${b.accessToken}`)
        .set('X-Organization-Id', b.organizationId)
        .expect(200);
      expect(asSuccess<ContactPayload[]>(ownRes.body)).toHaveLength(0);
    });
  });

  describe('contact deletion protection (F5)', () => {
    async function createContact(
      accessToken: string,
      organizationId: string,
      firstName: string,
    ): Promise<string> {
      const res = await request(server)
        .post('/api/v1/contacts')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ firstName })
        .expect(201);
      return asSuccess<ContactPayload>(res.body).id;
    }

    it('deletes a contact with no references (unchanged behavior)', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'f5-free@korva.test',
        'F5 Free Org',
      );
      const contactId = await createContact(
        accessToken,
        organizationId,
        'Unreferenced',
      );

      const res = await request(server)
        .delete(`/api/v1/contacts/${contactId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<{ deleted: boolean }>(res.body)).toEqual({
        deleted: true,
      });

      await request(server)
        .get(`/api/v1/contacts/${contactId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(404);
    });

    it('blocks deletion of a contact referenced by a lead, and leaves it intact', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'f5-lead@korva.test',
        'F5 Lead Org',
      );
      const contactId = await createContact(
        accessToken,
        organizationId,
        'Prospect',
      );
      const pipelineRes = await request(server)
        .post('/api/v1/pipelines')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'Sales',
          isDefault: true,
          stages: [{ name: 'New', order: 0 }],
        })
        .expect(201);
      const pipeline = asSuccess<PipelinePayload>(pipelineRes.body);

      await request(server)
        .post('/api/v1/leads')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          pipelineId: pipeline.id,
          stageId: pipeline.stages[0]!.id,
        })
        .expect(201);

      const res = await request(server)
        .delete(`/api/v1/contacts/${contactId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(409);
      expect(asError(res.body).code).toBe('CONTACT_IN_USE');

      await request(server)
        .get(`/api/v1/contacts/${contactId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
    });

    it('blocks deletion of a contact referenced by a conversation (a different entity than Lead)', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'f5-convo@korva.test',
        'F5 Convo Org',
      );
      await request(server)
        .patch('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ enabledModules: ['crm', 'communication'] })
        .expect(200);

      const contactId = await createContact(
        accessToken,
        organizationId,
        'Correspondent',
      );

      await request(server)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ contactId, channel: 'internal' })
        .expect(201);

      const res = await request(server)
        .delete(`/api/v1/contacts/${contactId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(409);
      expect(asError(res.body).code).toBe('CONTACT_IN_USE');
    });

    it('never lets a reference from a different organization block deletion', async () => {
      const orgA = await registerOrgAndToken(
        'f5-tenant-a@korva.test',
        'F5 Tenant A',
      );
      const orgB = await registerOrgAndToken(
        'f5-tenant-b@korva.test',
        'F5 Tenant B',
      );
      const contactAId = await createContact(
        orgA.accessToken,
        orgA.organizationId,
        'Org A Contact',
      );

      // Simulated foreign-org reference: a document that would never be produced by the real
      // app (a lead can only ever be created against a contact in its own organization), used
      // here purely to prove hasAnyReference's Mongo filter is genuinely scoped by
      // organizationId — not relying on contactId uniqueness alone to stay safe.
      await connection.collection('leads').insertOne({
        organizationId: new Types.ObjectId(orgB.organizationId),
        contactId: new Types.ObjectId(contactAId),
        pipelineId: new Types.ObjectId(),
        stageId: new Types.ObjectId(),
        status: 'open',
        customFields: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await request(server)
        .delete(`/api/v1/contacts/${contactAId}`)
        .set('Authorization', `Bearer ${orgA.accessToken}`)
        .set('X-Organization-Id', orgA.organizationId)
        .expect(200);
    });

    it('returns 404 for a contact that does not exist', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'f5-missing@korva.test',
        'F5 Missing Org',
      );

      const res = await request(server)
        .delete('/api/v1/contacts/000000000000000000000000')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(404);
      expect(asError(res.body).code).toBe('CONTACT_NOT_FOUND');
    });

    it("returns 404 (not a false CONTACT_IN_USE) when deleting another tenant's contact", async () => {
      const orgA = await registerOrgAndToken(
        'f5-cross-a@korva.test',
        'F5 Cross A',
      );
      const orgB = await registerOrgAndToken(
        'f5-cross-b@korva.test',
        'F5 Cross B',
      );
      const contactBId = await createContact(
        orgB.accessToken,
        orgB.organizationId,
        'Belongs To B',
      );

      const res = await request(server)
        .delete(`/api/v1/contacts/${contactBId}`)
        .set('Authorization', `Bearer ${orgA.accessToken}`)
        .set('X-Organization-Id', orgA.organizationId)
        .expect(404);
      expect(asError(res.body).code).toBe('CONTACT_NOT_FOUND');
    });

    it('denies a STAFF member (no contacts.delete) from deleting a contact', async () => {
      const owner = await registerOrgAndToken(
        'f5-rbac-owner@korva.test',
        'F5 RBAC Org',
      );
      const staffAuthRes = await request(server)
        .post('/api/v1/auth/register')
        .send({ email: 'f5-rbac-staff@korva.test', password: 'password123' })
        .expect(201);
      const staffToken = asSuccess<AuthPayload>(staffAuthRes.body).accessToken;

      const staffRole = await connection.collection('roles').findOne({
        organizationId: new Types.ObjectId(owner.organizationId),
        systemKey: 'STAFF',
      });
      expect(staffRole).not.toBeNull();

      await request(server)
        .post('/api/v1/organizations/me/members')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set('X-Organization-Id', owner.organizationId)
        .send({
          email: 'f5-rbac-staff@korva.test',
          roleId: String(staffRole?._id),
        })
        .expect(201);

      const contactId = await createContact(
        owner.accessToken,
        owner.organizationId,
        'Protected',
      );

      const res = await request(server)
        .delete(`/api/v1/contacts/${contactId}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', owner.organizationId)
        .expect(403);
      expect(asError(res.body).code).toBe('PERMISSION_DENIED');
    });
  });

  describe('contact merge', () => {
    async function createContact(
      accessToken: string,
      organizationId: string,
      body: Record<string, unknown>,
    ): Promise<ContactPayload> {
      const res = await request(server)
        .post('/api/v1/contacts')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send(body)
        .expect(201);
      return asSuccess<ContactPayload>(res.body);
    }

    it('rejects merging a contact with itself', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'merge-self@korva.test',
        'Merge Self Org',
      );
      const contact = await createContact(accessToken, organizationId, {
        firstName: 'Solo',
      });

      const res = await request(server)
        .post(`/api/v1/contacts/${contact.id}/merge`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ duplicateContactId: contact.id })
        .expect(400);
      expect(asError(res.body).code).toBe('CONTACT_MERGE_SAME_CONTACT');
    });

    it('404s when either side of the merge does not exist', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'merge-missing@korva.test',
        'Merge Missing Org',
      );
      const contact = await createContact(accessToken, organizationId, {
        firstName: 'Real',
      });

      const res = await request(server)
        .post(`/api/v1/contacts/${contact.id}/merge`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ duplicateContactId: '000000000000000000000000' })
        .expect(404);
      expect(asError(res.body).code).toBe('CONTACT_NOT_FOUND');
    });

    it('re-points a lead (direct contactId) and a task (polymorphic entity/entityId) from the duplicate to the primary, backfills blank fields, unions tags, and deletes the duplicate', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'merge-full@korva.test',
        'Merge Full Org',
      );

      const primary = await createContact(accessToken, organizationId, {
        firstName: 'Jean',
        tags: ['vip'],
      });
      const duplicate = await createContact(accessToken, organizationId, {
        firstName: 'Jean',
        phone: '+33600000000',
        tags: ['newsletter'],
      });

      const pipelineRes = await request(server)
        .post('/api/v1/pipelines')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'Sales',
          isDefault: true,
          stages: [{ name: 'New', order: 0 }],
        })
        .expect(201);
      const pipeline = asSuccess<PipelinePayload>(pipelineRes.body);

      const leadRes = await request(server)
        .post('/api/v1/leads')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId: duplicate.id,
          pipelineId: pipeline.id,
          stageId: pipeline.stages[0]!.id,
        })
        .expect(201);
      const leadId = asSuccess<LeadPayload>(leadRes.body).id;

      const taskRes = await request(server)
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          title: 'Follow up',
          entity: 'contact',
          entityId: duplicate.id,
        })
        .expect(201);
      const taskId = asSuccess<TaskPayload>(taskRes.body).id;

      const mergeRes = await request(server)
        .post(`/api/v1/contacts/${primary.id}/merge`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ duplicateContactId: duplicate.id })
        .expect(201);
      const merged = asSuccess<ContactPayload>(mergeRes.body);

      // Primary's own values win, but a field it never had is backfilled from the duplicate.
      expect(merged.firstName).toBe('Jean');
      expect(merged.phone).toBe('+33600000000');
      expect(merged.tags.sort()).toEqual(['newsletter', 'vip']);

      const leadAfter = await request(server)
        .get(`/api/v1/leads/${leadId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<LeadPayload>(leadAfter.body).contactId).toBe(primary.id);

      // No GET /tasks/:id route exists — verified directly, same convention as this file's
      // other direct-DB checks (see the cross-tenant reference test above).
      const taskAfter = await connection
        .collection<{ entityId?: Types.ObjectId }>('tasks')
        .findOne({ _id: new Types.ObjectId(taskId) });
      expect(taskAfter?.entityId?.toString()).toBe(primary.id);

      await request(server)
        .get(`/api/v1/contacts/${duplicate.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(404);
    });

    it('refuses to merge two contacts that each have their own customer portal login', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'merge-accounts-owner@korva.test',
        'Merge Accounts Org',
      );
      const orgRes = await request(server)
        .get('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const slug = asSuccess<{ slug: string }>(orgRes.body).slug;

      // toPublicCustomer() returns the CustomerAccount's own id, not the underlying Contact's —
      // resolve the real contactId directly, same "query the collection" convention this file
      // already uses elsewhere for facts the public API deliberately doesn't expose.
      async function contactIdForAccount(accountId: string): Promise<string> {
        const account = await connection
          .collection<{ contactId: Types.ObjectId }>('customer_accounts')
          .findOne({ _id: new Types.ObjectId(accountId) });
        return account!.contactId.toString();
      }

      const customerAOneRes = await request(server)
        .post(`/api/v1/public/${slug}/account/register`)
        .send({ email: 'buyer-one@example.com', password: 'clientpass123' })
        .expect(201);
      const contactAId = await contactIdForAccount(
        asSuccess<CustomerAuthPayload>(customerAOneRes.body).customer.id,
      );

      const customerBRes = await request(server)
        .post(`/api/v1/public/${slug}/account/register`)
        .send({ email: 'buyer-two@example.com', password: 'clientpass123' })
        .expect(201);
      const contactBId = await contactIdForAccount(
        asSuccess<CustomerAuthPayload>(customerBRes.body).customer.id,
      );

      const res = await request(server)
        .post(`/api/v1/contacts/${contactAId}/merge`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ duplicateContactId: contactBId })
        .expect(409);
      expect(asError(res.body).code).toBe(
        'CONTACT_MERGE_BOTH_HAVE_CUSTOMER_ACCOUNTS',
      );

      // Refused cleanly — neither contact was touched.
      await request(server)
        .get(`/api/v1/contacts/${contactBId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
    });

    it('transfers a customer portal login when only the duplicate has one', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'merge-one-account-owner@korva.test',
        'Merge One Account Org',
      );
      const orgRes = await request(server)
        .get('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const slug = asSuccess<{ slug: string }>(orgRes.body).slug;

      const primary = await createContact(accessToken, organizationId, {
        firstName: 'Staff-created',
      });
      const customerRes = await request(server)
        .post(`/api/v1/public/${slug}/account/register`)
        .send({
          email: 'self-registered@example.com',
          password: 'clientpass123',
        })
        .expect(201);
      const accountId = asSuccess<CustomerAuthPayload>(customerRes.body)
        .customer.id;
      const account = await connection
        .collection<{ contactId: Types.ObjectId }>('customer_accounts')
        .findOne({ _id: new Types.ObjectId(accountId) });
      const duplicateId = account!.contactId.toString();

      await request(server)
        .post(`/api/v1/contacts/${primary.id}/merge`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ duplicateContactId: duplicateId })
        .expect(201);

      // The account itself keeps its own identity/credentials (login still works, same
      // account id — merging never touches the CustomerAccount's own _id) but now links to
      // the primary contact instead of the deleted duplicate.
      const loginRes = await request(server)
        .post(`/api/v1/public/${slug}/account/login`)
        .send({
          email: 'self-registered@example.com',
          password: 'clientpass123',
        })
        .expect(201);
      expect(asSuccess<CustomerAuthPayload>(loginRes.body).customer.id).toBe(
        accountId,
      );

      const accountAfter = await connection
        .collection<{ contactId: Types.ObjectId }>('customer_accounts')
        .findOne({ _id: new Types.ObjectId(accountId) });
      expect(accountAfter?.contactId.toString()).toBe(primary.id);
    });
  });

  describe('duplicate contact detection', () => {
    async function createContact(
      accessToken: string,
      organizationId: string,
      body: Record<string, unknown>,
    ): Promise<ContactPayload> {
      const res = await request(server)
        .post('/api/v1/contacts')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send(body)
        .expect(201);
      return asSuccess<ContactPayload>(res.body);
    }

    it('groups contacts sharing the same email, and separately the same phone, but never mixes an unrelated singleton in', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'duplicates@korva.test',
        'Duplicates Org',
      );
      await createContact(accessToken, organizationId, {
        firstName: 'A1',
        email: 'shared@example.com',
      });
      await createContact(accessToken, organizationId, {
        firstName: 'A2',
        email: 'shared@example.com',
      });
      await createContact(accessToken, organizationId, {
        firstName: 'B1',
        phone: '+33611111111',
      });
      await createContact(accessToken, organizationId, {
        firstName: 'B2',
        phone: '+33611111111',
      });
      await createContact(accessToken, organizationId, {
        firstName: 'Unique',
        email: 'nobody-else@example.com',
      });

      const res = await request(server)
        .get('/api/v1/contacts/duplicates')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const groups = asSuccess<DuplicateGroupPayload[]>(res.body);

      expect(groups).toHaveLength(2);
      const emailGroup = groups.find((g) => g.field === 'email')!;
      expect(emailGroup.contacts.map((c) => c.firstName).sort()).toEqual([
        'A1',
        'A2',
      ]);
      const phoneGroup = groups.find((g) => g.field === 'phone')!;
      expect(phoneGroup.contacts.map((c) => c.firstName).sort()).toEqual([
        'B1',
        'B2',
      ]);
    });

    it('reports no duplicates for an organization with none', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'no-duplicates@korva.test',
        'No Duplicates Org',
      );
      await createContact(accessToken, organizationId, { firstName: 'Solo' });

      const res = await request(server)
        .get('/api/v1/contacts/duplicates')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<DuplicateGroupPayload[]>(res.body)).toHaveLength(0);
    });
  });
});
