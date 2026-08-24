import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import mongoose, { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { EventBusService } from '../src/core/events/event-bus.service';
import {
  ClaimActionResult,
  WorkflowsRepository,
} from '../src/workflow/workflows.repository';
import {
  Workflow,
  WorkflowDocument,
} from '../src/workflow/schemas/workflow.schema';
import {
  WorkflowExecution,
  WorkflowExecutionDocument,
} from '../src/workflow/schemas/workflow-execution.schema';
import {
  WorkflowActionClaim,
  WorkflowActionClaimDocument,
  WorkflowActionClaimSchema,
} from '../src/workflow/schemas/workflow-action-claim.schema';

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
    // Jest's default 5000ms hook timeout is too tight for a full AppModule boot (every module,
    // not just this file's) plus dropDatabase/syncIndexes on this machine — reproduced against
    // the pre-G4-FIX2 baseline too, so this is pre-existing infra timing, unrelated to the claim
    // fix below.
  }, 30000);

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
    /** Narrows a ClaimActionResult to its 'claimed' branch so `.leaseExpiresAt` is accessible. */
    function requireClaimed(
      result: ClaimActionResult,
    ): Extract<ClaimActionResult, { status: 'claimed' }> {
      if (result.status !== 'claimed') {
        throw new Error(`expected 'claimed', got '${result.status}'`);
      }
      return result;
    }

    it('a fresh key: first claim wins', async () => {
      const repository = app.get(WorkflowsRepository);
      const organizationId = new Types.ObjectId().toString();
      const workflowId = new Types.ObjectId();
      const eventKey = `lead.created:${new Types.ObjectId().toString()}`;

      const result = await repository.claimAction(
        organizationId,
        workflowId,
        0,
        eventKey,
      );

      expect(result.status).toBe('claimed');
    });

    it('two simultaneous claims on the same (workflow, action, event) key: exactly one wins', async () => {
      const repository = app.get(WorkflowsRepository);
      const organizationId = new Types.ObjectId().toString();
      const workflowId = new Types.ObjectId();
      const eventKey = `lead.created:${new Types.ObjectId().toString()}`;

      const [first, second] = await Promise.all([
        repository.claimAction(organizationId, workflowId, 0, eventKey),
        repository.claimAction(organizationId, workflowId, 0, eventKey),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual(['already-claimed', 'claimed']);
    });

    it('a claim that never reaches "succeeded" stays re-claimable once its holder explicitly releases it (markActionFailed), modeling a real BullMQ retry', async () => {
      const repository = app.get(WorkflowsRepository);
      const organizationId = new Types.ObjectId().toString();
      const workflowId = new Types.ObjectId();
      const eventKey = `lead.created:${new Types.ObjectId().toString()}`;

      const attempt1 = requireClaimed(
        await repository.claimAction(organizationId, workflowId, 0, eventKey),
      );
      // attempt1's effect failed — WorkflowActionsService.execute's catch block would call this
      // itself, passing back the exact lease attempt1 was granted; called directly here since
      // this test exercises the repository in isolation. Its holder is still the current owner,
      // so the release must apply.
      const released = await repository.markActionFailed(
        organizationId,
        workflowId,
        0,
        eventKey,
        attempt1.leaseExpiresAt,
      );
      const attempt2 = await repository.claimAction(
        organizationId,
        workflowId,
        0,
        eventKey,
      );

      expect(released).toBe(true);
      expect(attempt2.status).toBe('claimed');
    });

    it('a claim whose lease has not expired is not re-claimable, even sequentially, until it is released', async () => {
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
      // No markActionFailed/markActionSucceeded call — the lease from attempt1 is still active.
      const attempt2 = await repository.claimAction(
        organizationId,
        workflowId,
        0,
        eventKey,
      );

      expect(attempt1.status).toBe('claimed');
      expect(attempt2.status).toBe('already-claimed');
    });

    it('once a claim is marked succeeded by its current owner, a later attempt on the same key is rejected as already done', async () => {
      const repository = app.get(WorkflowsRepository);
      const organizationId = new Types.ObjectId().toString();
      const workflowId = new Types.ObjectId();
      const eventKey = `lead.created:${new Types.ObjectId().toString()}`;

      const claimed = requireClaimed(
        await repository.claimAction(organizationId, workflowId, 0, eventKey),
      );
      const finalized = await repository.markActionSucceeded(
        organizationId,
        workflowId,
        0,
        eventKey,
        claimed.leaseExpiresAt,
      );
      const retry = await repository.claimAction(
        organizationId,
        workflowId,
        0,
        eventKey,
      );

      expect(finalized).toBe(true);
      expect(retry.status).toBe('already-succeeded');
    });

    it('a crashed holder that never releases its claim is only re-claimable once the lease itself expires', async () => {
      const repository = app.get(WorkflowsRepository);
      const claimModel = app.get<Model<WorkflowActionClaimDocument>>(
        getModelToken(WorkflowActionClaim.name),
      );
      const organizationId = new Types.ObjectId().toString();
      const workflowId = new Types.ObjectId();
      const eventKey = `lead.created:${new Types.ObjectId().toString()}`;

      const attempt1 = await repository.claimAction(
        organizationId,
        workflowId,
        0,
        eventKey,
      );
      // Simulates the holder crashing before it can call markActionFailed/markActionSucceeded —
      // no application code left to release the lease, so this directly backdates it the way the
      // passage of real time would. This is the one behavior that can't be exercised without
      // either a ~60s real wait or touching the row directly; see the G4-FIX2 audit report.
      await claimModel.updateOne(
        {
          organizationId: new Types.ObjectId(organizationId),
          workflowId,
          actionIndex: 0,
          eventKey,
        },
        { $set: { leaseExpiresAt: new Date(0) } },
      );
      const attempt2 = await repository.claimAction(
        organizationId,
        workflowId,
        0,
        eventKey,
      );

      expect(attempt1.status).toBe('claimed');
      expect(attempt2.status).toBe('claimed');
    });

    describe('ownership-safe finalize/release (LOT G4-POST-AUDIT / G4-FIX3)', () => {
      /**
       * Shared setup for every test below: A claims and stalls (its lease is backdated exactly
       * like the "crashed holder" test above — the only way to simulate a stalled BullMQ worker
       * without a real 60s wait), then B legitimately re-claims with a fresh lease. From here, A
       * is a *stale* owner: it still has its original (now-superseded) leaseExpiresAt in hand and
       * may, in a real deployment, still be alive and about to call markActionFailed/
       * markActionSucceeded with it — exactly the scenario the G4-POST-AUDIT report demonstrated
       * as exploitable against the pre-G4-FIX3 (business-key-only) filter.
       */
      async function setupStaleOwnerAndCurrentOwner(
        claimModel: Model<WorkflowActionClaimDocument>,
      ) {
        const repository = app.get(WorkflowsRepository);
        const organizationId = new Types.ObjectId().toString();
        const workflowId = new Types.ObjectId();
        const eventKey = `lead.created:${new Types.ObjectId().toString()}`;

        const leaseA = requireClaimed(
          await repository.claimAction(organizationId, workflowId, 0, eventKey),
        ).leaseExpiresAt;
        await claimModel.updateOne(
          {
            organizationId: new Types.ObjectId(organizationId),
            workflowId,
            actionIndex: 0,
            eventKey,
          },
          { $set: { leaseExpiresAt: new Date(0) } },
        );
        const leaseB = requireClaimed(
          await repository.claimAction(organizationId, workflowId, 0, eventKey),
        ).leaseExpiresAt;

        expect(leaseB.getTime()).toBeGreaterThan(leaseA.getTime());

        return {
          repository,
          organizationId,
          workflowId,
          eventKey,
          leaseA,
          leaseB,
        };
      }

      it("a stale owner's late markActionFailed cannot release a claim now held by a different owner, and a third claimant still sees it as taken", async () => {
        const claimModel = app.get<Model<WorkflowActionClaimDocument>>(
          getModelToken(WorkflowActionClaim.name),
        );
        const {
          repository,
          organizationId,
          workflowId,
          eventKey,
          leaseA,
          leaseB,
        } = await setupStaleOwnerAndCurrentOwner(claimModel);

        // A, unaware it lost ownership, finally gives up and releases with its OWN (stale) lease.
        const released = await repository.markActionFailed(
          organizationId,
          workflowId,
          0,
          eventKey,
          leaseA,
        );
        expect(released).toBe(false);

        const afterStaleRelease = await claimModel.findOne({
          organizationId: new Types.ObjectId(organizationId),
          workflowId,
          actionIndex: 0,
          eventKey,
        });
        expect(afterStaleRelease?.status).toBe('claimed');
        expect(afterStaleRelease?.leaseExpiresAt.getTime()).toBe(
          leaseB.getTime(),
        );

        // A third claimant must still see B's claim as active — never a second 'claimed'.
        const cResult = await repository.claimAction(
          organizationId,
          workflowId,
          0,
          eventKey,
        );
        expect(cResult.status).toBe('already-claimed');

        // B, the real current owner, can still release/finalize normally afterward.
        const bReleased = await repository.markActionFailed(
          organizationId,
          workflowId,
          0,
          eventKey,
          leaseB,
        );
        expect(bReleased).toBe(true);
      });

      it("a stale owner's late markActionSucceeded cannot finalize a claim now held by a different owner, who can still finalize it correctly afterward", async () => {
        const claimModel = app.get<Model<WorkflowActionClaimDocument>>(
          getModelToken(WorkflowActionClaim.name),
        );
        const {
          repository,
          organizationId,
          workflowId,
          eventKey,
          leaseA,
          leaseB,
        } = await setupStaleOwnerAndCurrentOwner(claimModel);

        // A, unaware it lost ownership, "succeeds" late and finalizes with its OWN (stale) lease.
        const finalizedByStaleOwner = await repository.markActionSucceeded(
          organizationId,
          workflowId,
          0,
          eventKey,
          leaseA,
        );
        expect(finalizedByStaleOwner).toBe(false);

        const afterStaleFinalize = await claimModel.findOne({
          organizationId: new Types.ObjectId(organizationId),
          workflowId,
          actionIndex: 0,
          eventKey,
        });
        expect(afterStaleFinalize?.status).toBe('claimed');
        expect(afterStaleFinalize?.leaseExpiresAt.getTime()).toBe(
          leaseB.getTime(),
        );

        // B, the real current owner, must still be able to finalize its own claim correctly.
        const finalizedByCurrentOwner = await repository.markActionSucceeded(
          organizationId,
          workflowId,
          0,
          eventKey,
          leaseB,
        );
        expect(finalizedByCurrentOwner).toBe(true);

        const afterRealFinalize = await claimModel.findOne({
          organizationId: new Types.ObjectId(organizationId),
          workflowId,
          actionIndex: 0,
          eventKey,
        });
        expect(afterRealFinalize?.status).toBe('succeeded');
      });
    });

    it('N concurrent claims on a fresh key: exactly one wins, every level repeated several times', async () => {
      const repository = app.get(WorkflowsRepository);

      for (const concurrency of [5, 10, 20]) {
        for (let repetition = 0; repetition < 5; repetition++) {
          const organizationId = new Types.ObjectId().toString();
          const workflowId = new Types.ObjectId();
          const eventKey = `lead.created:${new Types.ObjectId().toString()}`;

          const outcomes = await Promise.all(
            Array.from({ length: concurrency }, () =>
              repository.claimAction(organizationId, workflowId, 0, eventKey),
            ),
          );

          const claimedCount = outcomes.filter(
            (o) => o.status === 'claimed',
          ).length;
          const alreadyClaimedCount = outcomes.filter(
            (o) => o.status === 'already-claimed',
          ).length;

          expect({
            concurrency,
            repetition,
            claimedCount,
            alreadyClaimedCount,
          }).toEqual({
            concurrency,
            repetition,
            claimedCount: 1,
            alreadyClaimedCount: concurrency - 1,
          });
        }
      }
    }, 30000);

    it('exactly one winner across two independent Mongo connections — a race is not just a same-process Promise.all artifact', async () => {
      const workflowModel = app.get<Model<WorkflowDocument>>(
        getModelToken(Workflow.name),
      );
      const executionModel = app.get<Model<WorkflowExecutionDocument>>(
        getModelToken(WorkflowExecution.name),
      );
      const repositoryA = app.get(WorkflowsRepository);

      // A second, fully independent connection to the same MongoDB deployment — its own socket,
      // its own driver-level session, no pooling/state shared with the app's connection. The
      // guarantee under test is enforced by MongoDB itself (the unique index plus per-document
      // write serialization), not by anything client-side, so two independent connections are
      // the faithful proxy for "two separate worker processes" without paying for an actual
      // second OS process/Nest application boot in every CI run.
      const secondConnection = await mongoose
        .createConnection(process.env.MONGODB_URI as string)
        .asPromise();
      // Mongoose's Model/Schema generics don't line up cleanly across two independently-built
      // Model instances of the same schema — this cast is asserting a structural fact (this is a
      // Model bound to WorkflowActionClaimSchema on the 'workflow_action_claims' collection, the
      // same runtime shape WorkflowsRepository's constructor expects), not papering over a type
      // error.
      const secondClaimModel = secondConnection.model(
        WorkflowActionClaim.name,
        WorkflowActionClaimSchema,
        'workflow_action_claims',
      ) as unknown as Model<WorkflowActionClaimDocument>;
      const repositoryB = new WorkflowsRepository(
        workflowModel,
        executionModel,
        secondClaimModel,
      );

      try {
        const organizationId = new Types.ObjectId().toString();
        const workflowId = new Types.ObjectId();
        const eventKey = `lead.created:${new Types.ObjectId().toString()}`;

        const [a, b] = await Promise.all([
          repositoryA.claimAction(organizationId, workflowId, 0, eventKey),
          repositoryB.claimAction(organizationId, workflowId, 0, eventKey),
        ]);

        const statuses = [a.status, b.status].sort();
        expect(statuses).toEqual(['already-claimed', 'claimed']);
      } finally {
        await secondConnection.close();
      }
    });

    it('tenant isolation: two organizations racing on the same workflowId/actionIndex/eventKey never collide', async () => {
      const repository = app.get(WorkflowsRepository);
      const organizationIdA = new Types.ObjectId().toString();
      const organizationIdB = new Types.ObjectId().toString();
      const workflowId = new Types.ObjectId();
      const eventKey = `lead.created:${new Types.ObjectId().toString()}`;

      const [a1, a2, b1, b2] = await Promise.all([
        repository.claimAction(organizationIdA, workflowId, 0, eventKey),
        repository.claimAction(organizationIdA, workflowId, 0, eventKey),
        repository.claimAction(organizationIdB, workflowId, 0, eventKey),
        repository.claimAction(organizationIdB, workflowId, 0, eventKey),
      ]);

      expect([a1.status, a2.status].sort()).toEqual([
        'already-claimed',
        'claimed',
      ]);
      expect([b1.status, b2.status].sort()).toEqual([
        'already-claimed',
        'claimed',
      ]);
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
