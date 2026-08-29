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
interface ExpensePayload {
  id: string;
  number: string;
  status: string;
  category: string;
  description: string;
  amount: number;
  currency: string;
}
interface WorkflowPayload {
  id: string;
}
interface WorkflowExecutionPayload {
  status: string;
  eventName: string;
  payload: Record<string, unknown>;
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

// Split out of finance.e2e-spec.ts (which was otherwise approaching/exceeding
// AUTH_THROTTLE's 30 registrations/60s budget for a single e2e file — see the identical
// rationale in catalog.e2e-spec.ts / payment-reconciliation.e2e-spec.ts). Each e2e spec file
// boots its own app, so moving this self-contained module here gives it a fresh budget.
describe('Expenses module (e2e)', () => {
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

  async function registerOrgAndContact(email: string, orgName: string) {
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
      .send({ enabledModules: ['crm', 'finance', 'workflow'] })
      .expect(200);

    const contactRes = await request(server)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ firstName: 'Client', lastName: 'Test' })
      .expect(201);
    const contactId = asSuccess<ContactPayload>(contactRes.body).id;

    return { accessToken, organizationId, contactId };
  }

  describe('Expenses module', () => {
    let accessToken: string;
    let organizationId: string;

    beforeAll(async () => {
      ({ accessToken, organizationId } = await registerOrgAndContact(
        'expenses-owner@korva.test',
        'Expenses Org',
      ));
    });

    function createExpenseReq(overrides: Record<string, unknown> = {}) {
      return request(server)
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          category: 'office_supplies',
          description: 'Printer paper',
          amount: 42.5,
          currency: 'EUR',
          date: new Date().toISOString(),
          vendor: 'Office Depot',
          ...overrides,
        });
    }

    it('creates an expense with a server-assigned number and "recorded" status', async () => {
      const res = await createExpenseReq().expect(201);
      const expense = asSuccess<ExpensePayload>(res.body);
      expect(expense.status).toBe('recorded');
      expect(expense.amount).toBe(42.5);
      expect(expense.number).toMatch(/^DEP-\d{4}$/);
    });

    it('rejects a non-positive amount', async () => {
      const res = await createExpenseReq({ amount: 0 }).expect(400);
      expect(asError(res.body).code).toBe('VALIDATION_ERROR');

      const resNeg = await createExpenseReq({ amount: -10 }).expect(400);
      expect(asError(resNeg.body).code).toBe('VALIDATION_ERROR');
    });

    it('rejects a currency code that is not exactly 3 letters', async () => {
      const res = await createExpenseReq({ currency: 'EU' }).expect(400);
      expect(asError(res.body).code).toBe('VALIDATION_ERROR');
      await createExpenseReq({ currency: 'EURO' }).expect(400);
    });

    it('lists and reads back the created expense', async () => {
      const createRes = await createExpenseReq({
        description: 'Listable expense',
      }).expect(201);
      const expenseId = asSuccess<ExpensePayload>(createRes.body).id;

      const listRes = await request(server)
        .get('/api/v1/expenses')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const list = asSuccess<ExpensePayload[]>(listRes.body);
      expect(list.some((e) => e.id === expenseId)).toBe(true);

      const getRes = await request(server)
        .get(`/api/v1/expenses/${expenseId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<ExpensePayload>(getRes.body).id).toBe(expenseId);
    });

    it('updates a recorded expense', async () => {
      const createRes = await createExpenseReq({
        description: 'To be updated',
      }).expect(201);
      const expenseId = asSuccess<ExpensePayload>(createRes.body).id;

      const updateRes = await request(server)
        .patch(`/api/v1/expenses/${expenseId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ amount: 99.9, description: 'Updated description' })
        .expect(200);
      const updated = asSuccess<ExpensePayload>(updateRes.body);
      expect(updated.amount).toBe(99.9);
      expect(updated.description).toBe('Updated description');
    });

    it('voids a recorded expense, then rejects editing it and rejects voiding it again (invalid transition)', async () => {
      const createRes = await createExpenseReq({
        description: 'To be voided',
      }).expect(201);
      const expenseId = asSuccess<ExpensePayload>(createRes.body).id;

      const voidRes = await request(server)
        .post(`/api/v1/expenses/${expenseId}/void`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      expect(asSuccess<ExpensePayload>(voidRes.body).status).toBe('voided');

      const editRes = await request(server)
        .patch(`/api/v1/expenses/${expenseId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ amount: 1 })
        .expect(400);
      expect(asError(editRes.body).code).toBe('EXPENSE_NOT_EDITABLE');

      const reVoidRes = await request(server)
        .post(`/api/v1/expenses/${expenseId}/void`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(400);
      expect(asError(reVoidRes.body).code).toBe('EXPENSE_INVALID_TRANSITION');
    });

    it('deletes an expense and then 404s reading it', async () => {
      const createRes = await createExpenseReq({
        description: 'To be deleted',
      }).expect(201);
      const expenseId = asSuccess<ExpensePayload>(createRes.body).id;

      const deleteRes = await request(server)
        .delete(`/api/v1/expenses/${expenseId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<{ deleted: boolean }>(deleteRes.body)).toEqual({
        deleted: true,
      });

      const getRes = await request(server)
        .get(`/api/v1/expenses/${expenseId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(404);
      expect(asError(getRes.body).code).toBe('EXPENSE_NOT_FOUND');
    });

    it('404s deleting an expense that does not exist', async () => {
      const res = await request(server)
        .delete('/api/v1/expenses/000000000000000000000000')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(404);
      expect(asError(res.body).code).toBe('EXPENSE_NOT_FOUND');
    });

    it('denies a user from another organization reading expenses via a foreign org id', async () => {
      const a = await registerOrgAndContact(
        'expenses-iso-a@korva.test',
        'Expenses Iso A',
      );
      const b = await registerOrgAndContact(
        'expenses-iso-b@korva.test',
        'Expenses Iso B',
      );

      await request(server)
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Organization-Id', a.organizationId)
        .send({
          category: 'travel',
          description: 'Secret expense',
          amount: 10,
          currency: 'EUR',
          date: new Date().toISOString(),
        })
        .expect(201);

      const res = await request(server)
        .get('/api/v1/expenses')
        .set('Authorization', `Bearer ${b.accessToken}`)
        .set('X-Organization-Id', a.organizationId)
        .expect(403);
      expect(asError(res.body).code).toBe('ORGANIZATION_ACCESS_DENIED');
    });

    it('denies a STAFF member (no invoices.create/update) from creating or deleting an expense, while still allowing read', async () => {
      const owner = await registerOrgAndContact(
        'expenses-rbac-owner@korva.test',
        'Expenses RBAC Org',
      );
      const staffAuthRes = await request(server)
        .post('/api/v1/auth/register')
        .send({
          email: 'expenses-rbac-staff@korva.test',
          password: 'password123',
        })
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
          email: 'expenses-rbac-staff@korva.test',
          roleId: String(staffRole?._id),
        })
        .expect(201);

      const createAsStaffRes = await request(server)
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', owner.organizationId)
        .send({
          category: 'travel',
          description: 'Should be denied',
          amount: 5,
          currency: 'EUR',
          date: new Date().toISOString(),
        })
        .expect(403);
      expect(asError(createAsStaffRes.body).code).toBe('PERMISSION_DENIED');

      const createRes = await request(server)
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set('X-Organization-Id', owner.organizationId)
        .send({
          category: 'travel',
          description: 'Owner-created',
          amount: 5,
          currency: 'EUR',
          date: new Date().toISOString(),
        })
        .expect(201);
      const expenseId = asSuccess<ExpensePayload>(createRes.body).id;

      const readAsStaffRes = await request(server)
        .get(`/api/v1/expenses/${expenseId}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', owner.organizationId)
        .expect(200);
      expect(asSuccess<ExpensePayload>(readAsStaffRes.body).id).toBe(expenseId);

      const deleteAsStaffRes = await request(server)
        .delete(`/api/v1/expenses/${expenseId}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', owner.organizationId)
        .expect(403);
      expect(asError(deleteAsStaffRes.body).code).toBe('PERMISSION_DENIED');
    });

    it('publishes expense.created, verified by a Workflow configured on it actually firing', async () => {
      const workflowRes = await request(server)
        .post('/api/v1/workflows')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'On expense created',
          trigger: 'expense.created',
          conditions: [],
          actions: [
            {
              type: 'create_task',
              config: { title: 'Review expense {{expenseId}}' },
            },
          ],
        })
        .expect(201);
      const workflowId = asSuccess<WorkflowPayload>(workflowRes.body).id;

      const expenseRes = await createExpenseReq({
        description: 'Event coverage probe expense',
      }).expect(201);
      const newExpenseId = asSuccess<ExpensePayload>(expenseRes.body).id;

      const executions = await waitFor(async () => {
        const res = await request(server)
          .get(`/api/v1/workflows/${workflowId}/executions`)
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .expect(200);
        const data = asSuccess<WorkflowExecutionPayload[]>(res.body);
        return data.length > 0 ? data : undefined;
      });

      expect(executions).toHaveLength(1);
      expect(executions[0]!.status).toBe('success');
      expect(executions[0]!.eventName).toBe('expense.created');
      expect(executions[0]!.payload.expenseId).toBe(newExpenseId);
    }, 20000);
  });
});
