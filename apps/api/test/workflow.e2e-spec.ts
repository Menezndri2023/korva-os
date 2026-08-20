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
}
interface PipelineStagePayload {
  id: string;
  name: string;
}
interface PipelinePayload {
  id: string;
  stages: PipelineStagePayload[];
}
interface WorkflowPayload {
  id: string;
  name: string;
  active: boolean;
  trigger: string;
}
interface WorkflowExecutionPayload {
  id: string;
  eventName: string;
  status: string;
}
interface TaskPayload {
  id: string;
  title: string;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

/** Async events are processed by a real BullMQ worker over Redis — poll until the side effect appears or the timeout elapses. */
async function waitFor<T>(
  check: () => Promise<T | undefined>,
  timeoutMs = 8000,
  intervalMs = 200,
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

describe('Workflow module (e2e)', () => {
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

  async function registerOrgContactPipeline(email: string, orgName: string) {
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

    const contactRes = await request(server)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ firstName: 'Prospect' })
      .expect(201);
    const contactId = asSuccess<ContactPayload>(contactRes.body).id;

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

    return {
      accessToken,
      organizationId,
      contactId,
      pipelineId: pipeline.id,
      stageId: pipeline.stages[0]!.id,
    };
  }

  describe('CRUD and dry-run test endpoint', () => {
    let accessToken: string;
    let organizationId: string;
    let workflowId: string;

    beforeAll(async () => {
      const ctx = await registerOrgContactPipeline(
        'workflow-crud@korva.test',
        'Workflow CRUD Org',
      );
      accessToken = ctx.accessToken;
      organizationId = ctx.organizationId;
    });

    it('creates a workflow', async () => {
      const res = await request(server)
        .post('/api/v1/workflows')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'High value lead follow-up',
          trigger: 'lead.created',
          conditions: [
            { field: 'estimatedValue', operator: 'greater_than', value: 1000 },
          ],
          actions: [
            {
              type: 'create_task',
              config: { title: 'Follow up on lead {{leadId}}' },
            },
          ],
        })
        .expect(201);
      const workflow = asSuccess<WorkflowPayload>(res.body);
      workflowId = workflow.id;
      expect(workflow.active).toBe(true);
      expect(workflow.trigger).toBe('lead.created');
    });

    it('rejects a workflow with an unknown trigger', async () => {
      const res = await request(server)
        .post('/api/v1/workflows')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'Invalid',
          trigger: 'not.a.real.event',
          actions: [{ type: 'create_task', config: { title: 'x' } }],
        })
        .expect(400);
      expect(asError(res.body).code).toBe('VALIDATION_ERROR');
    });

    it('lists and reads back the workflow', async () => {
      const listRes = await request(server)
        .get('/api/v1/workflows')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<WorkflowPayload[]>(listRes.body)).toHaveLength(1);

      const getRes = await request(server)
        .get(`/api/v1/workflows/${workflowId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<WorkflowPayload>(getRes.body).id).toBe(workflowId);
    });

    it('dry-runs the workflow conditions without executing any action', async () => {
      const matchRes = await request(server)
        .post(`/api/v1/workflows/${workflowId}/test`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ payload: { estimatedValue: 5000 } })
        .expect(201);
      expect(asSuccess<{ matched: boolean }>(matchRes.body).matched).toBe(true);

      const noMatchRes = await request(server)
        .post(`/api/v1/workflows/${workflowId}/test`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ payload: { estimatedValue: 10 } })
        .expect(201);
      expect(asSuccess<{ matched: boolean }>(noMatchRes.body).matched).toBe(
        false,
      );

      const tasksRes = await request(server)
        .get('/api/v1/tasks')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<TaskPayload[]>(tasksRes.body)).toHaveLength(0);
    });

    it('updates the workflow', async () => {
      const res = await request(server)
        .patch(`/api/v1/workflows/${workflowId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ name: 'High value lead follow-up (updated)' })
        .expect(200);
      expect(asSuccess<WorkflowPayload>(res.body).name).toBe(
        'High value lead follow-up (updated)',
      );
    });

    it('deletes the workflow and then 404s on it', async () => {
      await request(server)
        .delete(`/api/v1/workflows/${workflowId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);

      const res = await request(server)
        .get(`/api/v1/workflows/${workflowId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(404);
      expect(asError(res.body).code).toBe('WORKFLOW_NOT_FOUND');
    });
  });

  describe('end-to-end async execution via the event bus', () => {
    let accessToken: string;
    let organizationId: string;
    let contactId: string;
    let pipelineId: string;
    let stageId: string;
    let matchingWorkflowId: string;

    beforeAll(async () => {
      const ctx = await registerOrgContactPipeline(
        'workflow-async@korva.test',
        'Workflow Async Org',
      );
      accessToken = ctx.accessToken;
      organizationId = ctx.organizationId;
      contactId = ctx.contactId;
      pipelineId = ctx.pipelineId;
      stageId = ctx.stageId;

      const matchingRes = await request(server)
        .post('/api/v1/workflows')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'Notify on qualified lead',
          trigger: 'lead.created',
          conditions: [
            { field: 'estimatedValue', operator: 'greater_than', value: 1000 },
          ],
          actions: [
            {
              type: 'create_task',
              config: { title: 'Qualified lead {{leadId}}' },
            },
          ],
        })
        .expect(201);
      matchingWorkflowId = asSuccess<WorkflowPayload>(matchingRes.body).id;

      await request(server)
        .post('/api/v1/workflows')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'Should never match',
          trigger: 'lead.created',
          conditions: [
            {
              field: 'estimatedValue',
              operator: 'greater_than',
              value: 999999,
            },
          ],
          actions: [
            {
              type: 'create_task',
              config: { title: 'Should not be created' },
            },
          ],
        })
        .expect(201);
    });

    it('creates a task once the async workflow engine processes the lead.created event', async () => {
      const leadRes = await request(server)
        .post('/api/v1/leads')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ contactId, pipelineId, stageId, estimatedValue: 5000 })
        .expect(201);
      const leadId = asSuccess<{ id: string }>(leadRes.body).id;

      const createdTask = await waitFor(async () => {
        const tasksRes = await request(server)
          .get('/api/v1/tasks')
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .expect(200);
        const tasks = asSuccess<TaskPayload[]>(tasksRes.body);
        return tasks.find((task) => task.title === `Qualified lead ${leadId}`);
      });
      expect(createdTask).toBeDefined();

      const tasksRes = await request(server)
        .get('/api/v1/tasks')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const titles = asSuccess<TaskPayload[]>(tasksRes.body).map(
        (task) => task.title,
      );
      expect(titles).not.toContain('Should not be created');

      const executions = await waitFor(async () => {
        const res = await request(server)
          .get(`/api/v1/workflows/${matchingWorkflowId}/executions`)
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .expect(200);
        const data = asSuccess<WorkflowExecutionPayload[]>(res.body);
        return data.length > 0 ? data : undefined;
      });
      expect(executions[0]!.status).toBe('success');
      expect(executions[0]!.eventName).toBe('lead.created');
    });
  });

  describe('tenant isolation for workflows', () => {
    it('denies a user from another organization reading workflows via a foreign org id', async () => {
      const a = await registerOrgContactPipeline(
        'workflow-iso-a@korva.test',
        'Workflow Iso A',
      );
      const b = await registerOrgContactPipeline(
        'workflow-iso-b@korva.test',
        'Workflow Iso B',
      );

      await request(server)
        .post('/api/v1/workflows')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Organization-Id', a.organizationId)
        .send({
          name: 'Secret workflow',
          trigger: 'lead.created',
          actions: [{ type: 'create_task', config: { title: 'x' } }],
        })
        .expect(201);

      const res = await request(server)
        .get('/api/v1/workflows')
        .set('Authorization', `Bearer ${b.accessToken}`)
        .set('X-Organization-Id', a.organizationId)
        .expect(403);
      expect(asError(res.body).code).toBe('ORGANIZATION_ACCESS_DENIED');
    });
  });
});
