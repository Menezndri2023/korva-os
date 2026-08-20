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
interface ContactPayload {
  id: string;
  firstName?: string;
  tags: string[];
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
  stageId: string;
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

  describe('pipelines and leads', () => {
    let accessToken: string;
    let organizationId: string;
    let contactId: string;
    let pipelineId: string;
    let stageAId: string;
    let stageBId: string;

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

    it('rejects a lead referencing a contact that does not exist', async () => {
      await request(server)
        .post('/api/v1/leads')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId: '000000000000000000000000',
          pipelineId,
          stageId: stageAId,
        })
        .expect(404);
    });

    it('rejects a lead referencing a stage that does not exist in the pipeline', async () => {
      await request(server)
        .post('/api/v1/leads')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ contactId, pipelineId, stageId: '000000000000000000000000' })
        .expect(404);
    });

    it('creates a lead and moves it through the pipeline to won', async () => {
      const createRes = await request(server)
        .post('/api/v1/leads')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          pipelineId,
          stageId: stageAId,
          estimatedValue: 1000,
        })
        .expect(201);
      const lead = asSuccess<LeadPayload>(createRes.body);
      expect(lead.status).toBe('open');

      const updateRes = await request(server)
        .patch(`/api/v1/leads/${lead.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ stageId: stageBId, status: 'won' })
        .expect(200);
      const updated = asSuccess<LeadPayload>(updateRes.body);
      expect(updated.status).toBe('won');
      expect(updated.stageId).toBe(stageBId);
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
});
