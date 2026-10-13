import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Types } from 'mongoose';
import { AppModule } from './../src/app.module';
import { RecurringBillingSchedulerService } from '../src/finance/recurring-billing/recurring-billing-scheduler.service';
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
interface RecurringBillingPayload {
  id: string;
  status: string;
  amount: number;
  currency: string;
  nextBillingDate: string;
  lastInvoiceId?: string;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

describe('Recurring billing (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  let accessToken: string;
  let organizationId: string;
  let contactId: string;
  let offerId: string;

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
      .send({
        email: 'recurring-billing-owner@example.com',
        password: 'password123',
      })
      .expect(201);
    accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Recurring Billing Org',
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
      .send({ enabledModules: ['crm', 'catalog', 'finance'] })
      .expect(200);

    const contactRes = await request(server)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        type: 'person',
        firstName: 'Member',
        email: 'member@example.com',
      })
      .expect(201);
    contactId = asSuccess<{ id: string }>(contactRes.body).id;

    const offerRes = await request(server)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        type: 'subscription',
        name: 'Abonnement mensuel',
        status: 'active',
        pricing: { amount: 49, currency: 'EUR' },
      })
      .expect(201);
    offerId = asSuccess<{ id: string }>(offerRes.body).id;
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();
  });

  it('creates a recurring billing plan, snapshotting the offer price', async () => {
    const res = await request(server)
      .post('/api/v1/recurring-billing')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ contactId, offerId, interval: 'monthly' })
      .expect(201);
    const plan = asSuccess<RecurringBillingPayload>(res.body);
    expect(plan.status).toBe('active');
    expect(plan.amount).toBe(49);
    expect(plan.currency).toBe('EUR');
  });

  it('lists the plan for the organization', async () => {
    const res = await request(server)
      .get('/api/v1/recurring-billing')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    expect(asSuccess<RecurringBillingPayload[]>(res.body)).toHaveLength(1);
  });

  it('rejects creating a plan for a nonexistent offer', async () => {
    const res = await request(server)
      .post('/api/v1/recurring-billing')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        contactId,
        offerId: '000000000000000000000000',
        interval: 'monthly',
      })
      .expect(404);
    expect(asError(res.body).code).toBe('OFFER_NOT_FOUND');
  });

  describe('the scheduler sweep', () => {
    let planId: string;

    beforeAll(async () => {
      const res = await request(server)
        .post('/api/v1/recurring-billing')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ contactId, offerId, interval: 'monthly' })
        .expect(201);
      planId = asSuccess<RecurringBillingPayload>(res.body).id;

      // Force the plan into the past so the very next sweep picks it up — same technique as
      // every other scheduler e2e test in this codebase (e.g. quote-expiry/booking-reminder)
      // for forcing a real-world-eligible row without waiting on a real interval.
      const model = connection.collection('recurring_billings');
      await model.updateOne(
        { _id: new Types.ObjectId(planId) },
        { $set: { nextBillingDate: new Date(Date.now() - 60_000) } },
      );
    });

    it('generates an invoice and advances nextBillingDate on the next sweep', async () => {
      await app.get(RecurringBillingSchedulerService).runSweep();

      const res = await request(server)
        .get(`/api/v1/recurring-billing/${planId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const plan = asSuccess<RecurringBillingPayload>(res.body);
      expect(plan.lastInvoiceId).toBeDefined();
      expect(new Date(plan.nextBillingDate).getTime()).toBeGreaterThan(
        Date.now(),
      );

      const invoiceRes = await request(server)
        .get(`/api/v1/invoices/${plan.lastInvoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const invoice = asSuccess<{ total: number; contactId: string }>(
        invoiceRes.body,
      );
      expect(invoice.total).toBe(49);
      expect(invoice.contactId).toBe(contactId);
    });

    it('a cancelled plan is skipped by the next sweep', async () => {
      await request(server)
        .post(`/api/v1/recurring-billing/${planId}/cancel`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      const model = connection.collection('recurring_billings');
      await model.updateOne(
        { _id: new Types.ObjectId(planId) },
        { $set: { nextBillingDate: new Date(Date.now() - 60_000) } },
      );

      const before = await request(server)
        .get(`/api/v1/recurring-billing/${planId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const invoiceCountBefore = asSuccess<RecurringBillingPayload>(
        before.body,
      ).lastInvoiceId;

      await app.get(RecurringBillingSchedulerService).runSweep();

      const after = await request(server)
        .get(`/api/v1/recurring-billing/${planId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<RecurringBillingPayload>(after.body).lastInvoiceId).toBe(
        invoiceCountBefore,
      );
    });
  });

  describe('cancellation', () => {
    let planId: string;

    beforeAll(async () => {
      const res = await request(server)
        .post('/api/v1/recurring-billing')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ contactId, offerId, interval: 'yearly' })
        .expect(201);
      planId = asSuccess<RecurringBillingPayload>(res.body).id;
    });

    it('cancels an active plan', async () => {
      const res = await request(server)
        .post(`/api/v1/recurring-billing/${planId}/cancel`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      expect(asSuccess<RecurringBillingPayload>(res.body).status).toBe(
        'cancelled',
      );
    });

    it('rejects cancelling an already-cancelled plan', async () => {
      const res = await request(server)
        .post(`/api/v1/recurring-billing/${planId}/cancel`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(400);
      expect(asError(res.body).code).toBe(
        'RECURRING_BILLING_ALREADY_CANCELLED',
      );
    });
  });
});
