import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { EventBusService } from '../src/core/events/event-bus.service';
import { WorkflowsRepository } from '../src/workflow/workflows.repository';

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

/**
 * Async events are processed by a real BullMQ worker over Redis — poll until the side effect
 * appears or the timeout elapses. 500ms (not 200ms): at 200ms, two waitFor calls in the same
 * test can burn through ~180 requests against ThrottlerGuard's real 120-req/60s limit on their
 * own, turning into a genuine 429 rather than the BullMQ processing actually being slow —
 * confirmed by reproduction (isolated runs failing with "got 429 Too Many Requests"). 500ms
 * caps a single call at 40 requests, comfortably under the limit. timeoutMs bumped from 18000
 * to 20000: the original outer Jest per-test timeout (25000) didn't actually leave room for
 * two sequential 18000ms waitFor calls in the same test, an existing mismatch independent of
 * the 429 issue — 20000 keeps that math honest without chasing the separate, deeper source of
 * intermittent delay documented in the audit report (reproduced even at 35000/45000, so this
 * is deliberately not inflated further to try to paper over it).
 */
async function waitFor<T>(
  check: () => Promise<T | undefined>,
  timeoutMs = 20000,
  intervalMs = 500,
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

    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ enabledModules: ['crm', 'workflow'] })
      .expect(200);

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
    // Must stay above the worst realistic case of two sequential waitFor calls (20000 each) —
    // the original 25000 didn't actually leave room for that even before the 429 fix, an
    // existing mismatch. In practice the second call (executions) resolves near-instantly once
    // the first succeeds, since both are written by the same job — reproduction never once
    // failed on the second call specifically.
    }, 26000);

    it('never creates a second Task when the identical lead.created event is published twice', async () => {
      const leadRes = await request(server)
        .post('/api/v1/leads')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ contactId, pipelineId, stageId, estimatedValue: 5000 })
        .expect(201);
      const leadId = asSuccess<{ id: string }>(leadRes.body).id;

      await waitFor(async () => {
        const tasksRes = await request(server)
          .get('/api/v1/tasks')
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .expect(200);
        const tasks = asSuccess<TaskPayload[]>(tasksRes.body);
        return tasks.find((task) => task.title === `Qualified lead ${leadId}`);
      });

      // Simulates a producer bug/retry publishing the identical logical event a second time —
      // same organizationId/eventName/payload as the one LeadsService.create() already
      // published for this exact lead. This must never create a second Task.
      const eventBus = app.get(EventBusService);
      await eventBus.publish(organizationId, 'lead.created', {
        leadId,
        contactId,
        estimatedValue: 5000,
      });

      // Give the (deliberately duplicate) job a real chance to be processed before asserting
      // there's still only one Task — waitFor would return on the first match either way.
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const tasksRes = await request(server)
        .get('/api/v1/tasks')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const matching = asSuccess<TaskPayload[]>(tasksRes.body).filter(
        (task) => task.title === `Qualified lead ${leadId}`,
      );
      expect(matching).toHaveLength(1);
    // Must stay above the waitFor budget (20000) plus the explicit 3s settle sleep after it.
    }, 26000);
  });

  describe('workflow action claim — concurrent execution of the same event', () => {
    it('two simultaneous claims on the same (workflow, action, event) key: exactly one wins', async () => {
      const repository = app.get(WorkflowsRepository);
      const organizationId = new Types.ObjectId().toString();
      const workflowId = new Types.ObjectId();
      const eventKey = `lead.created:${new Types.ObjectId().toString()}`;

      const [first, second] = await Promise.all([
        repository.claimAction(organizationId, workflowId, 0, eventKey),
        repository.claimAction(organizationId, workflowId, 0, eventKey),
      ]);

      const outcomes = [first, second].sort();
      expect(outcomes).toEqual(['already-claimed', 'claimed']);
    });

    it('a claim that never reaches "succeeded" stays re-claimable by a later sequential attempt', async () => {
      const repository = app.get(WorkflowsRepository);
      const organizationId = new Types.ObjectId().toString();
      const workflowId = new Types.ObjectId();
      const eventKey = `lead.created:${new Types.ObjectId().toString()}`;

      const attempt1 = await repository.claimAction(
        organizationId,
        workflowId,
        0,
        eventKey,
      );
      // attempt1's effect "failed" here — no markActionSucceeded call — modeling a job retry.
      const attempt2 = await repository.claimAction(
        organizationId,
        workflowId,
        0,
        eventKey,
      );

      expect(attempt1).toBe('claimed');
      expect(attempt2).toBe('claimed');
    });

    it('once a claim is marked succeeded, a later attempt on the same key is rejected as already done', async () => {
      const repository = app.get(WorkflowsRepository);
      const organizationId = new Types.ObjectId().toString();
      const workflowId = new Types.ObjectId();
      const eventKey = `lead.created:${new Types.ObjectId().toString()}`;

      await repository.claimAction(organizationId, workflowId, 0, eventKey);
      await repository.markActionSucceeded(
        organizationId,
        workflowId,
        0,
        eventKey,
      );
      const retry = await repository.claimAction(
        organizationId,
        workflowId,
        0,
        eventKey,
      );

      expect(retry).toBe('already-succeeded');
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
