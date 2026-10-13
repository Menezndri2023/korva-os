import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
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
interface ProjectPayload {
  id: string;
  status: string;
  name: string;
}
interface ProjectSummaryPayload {
  project: ProjectPayload;
  totalHoursLogged: number;
  billableHoursLogged: number;
  totalBilled: number;
  openTaskCount: number;
  totalTaskCount: number;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

describe('Projects (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  let accessToken: string;
  let organizationId: string;
  let contactId: string;

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
      .send({ email: 'projects-owner@example.com', password: 'password123' })
      .expect(201);
    accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Projects Org',
        type: 'services',
        country: 'FR',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        language: 'fr',
      })
      .expect(201);
    organizationId = asSuccess<OrganizationPayload>(orgRes.body).id;

    await putOrganizationOnPlan(connection, organizationId);
    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ enabledModules: ['crm', 'finance'] })
      .expect(200);

    const contactRes = await request(server)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        type: 'person',
        firstName: 'Client',
        email: 'client@example.com',
      })
      .expect(201);
    contactId = asSuccess<{ id: string }>(contactRes.body).id;
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();
  });

  it('creates a project defaulting to active status', async () => {
    const res = await request(server)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ contactId, name: 'Refonte du site' })
      .expect(201);
    const project = asSuccess<ProjectPayload>(res.body);
    expect(project.status).toBe('active');
    expect(project.name).toBe('Refonte du site');
  });

  it('rejects creating a project for a nonexistent contact', async () => {
    const res = await request(server)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ contactId: '000000000000000000000000', name: 'Ghost project' })
      .expect(404);
    expect(asError(res.body).code).toBe('CONTACT_NOT_FOUND');
  });

  it('lists projects for the organization', async () => {
    const res = await request(server)
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    expect(asSuccess<ProjectPayload[]>(res.body).length).toBeGreaterThan(0);
  });

  it('updates a project (status, name)', async () => {
    const createRes = await request(server)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ contactId, name: 'Mission audit' })
      .expect(201);
    const projectId = asSuccess<ProjectPayload>(createRes.body).id;

    const updateRes = await request(server)
      .patch(`/api/v1/projects/${projectId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ status: 'on_hold' })
      .expect(200);
    expect(asSuccess<ProjectPayload>(updateRes.body).status).toBe('on_hold');
  });

  describe('summary aggregation', () => {
    let projectId: string;

    beforeAll(async () => {
      const createRes = await request(server)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ contactId, name: 'Migration ERP' })
        .expect(201);
      projectId = asSuccess<ProjectPayload>(createRes.body).id;

      // One invoiced (billed) entry, one still-unbilled entry, and one open + one done task.
      const invoicedEntryRes = await request(server)
        .post('/api/v1/time-entries')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          projectId,
          date: new Date().toISOString(),
          durationMinutes: 120,
          description: 'Cadrage',
          billable: true,
          hourlyRate: 100,
          currency: 'EUR',
        })
        .expect(201);
      const invoicedEntryId = asSuccess<{ id: string }>(
        invoicedEntryRes.body,
      ).id;

      await request(server)
        .post(`/api/v1/time-entries/${invoicedEntryId}/approve`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      await request(server)
        .post('/api/v1/time-entries/generate-invoice')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ timeEntryIds: [invoicedEntryId] })
        .expect(201);

      await request(server)
        .post('/api/v1/time-entries')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          projectId,
          date: new Date().toISOString(),
          durationMinutes: 60,
          description: 'Suivi',
          billable: true,
          hourlyRate: 100,
          currency: 'EUR',
        })
        .expect(201);

      await request(server)
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          title: 'Livrer la spec',
          entity: 'project',
          entityId: projectId,
        })
        .expect(201);

      const doneTaskRes = await request(server)
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ title: 'Kickoff', entity: 'project', entityId: projectId })
        .expect(201);
      const doneTaskId = asSuccess<{ id: string }>(doneTaskRes.body).id;
      await request(server)
        .patch(`/api/v1/tasks/${doneTaskId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ status: 'done' })
        .expect(200);
    });

    it('aggregates hours logged, billed amount, and task counts', async () => {
      const res = await request(server)
        .get(`/api/v1/projects/${projectId}/summary`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const summary = asSuccess<ProjectSummaryPayload>(res.body);

      expect(summary.totalHoursLogged).toBe(3); // 120min + 60min
      expect(summary.billableHoursLogged).toBe(3);
      expect(summary.totalBilled).toBe(200); // only the 2h invoiced entry × 100/h
      expect(summary.totalTaskCount).toBe(2);
      expect(summary.openTaskCount).toBe(1);
    });

    it('filters time entries by projectId', async () => {
      const res = await request(server)
        .get(`/api/v1/time-entries?projectId=${projectId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<unknown[]>(res.body)).toHaveLength(2);
    });
  });
});
