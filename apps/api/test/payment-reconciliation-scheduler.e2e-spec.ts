import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PaymentsRepository } from '../src/finance/payments/payments.repository';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from '../src/finance/payments/providers/payment-provider.interface';
import { PaymentReconciliationService } from '../src/finance/payments/payment-reconciliation.service';
import {
  RECONCILIATION_QUEUE_NAME,
  RECONCILIATION_SCHEDULER_ID,
  ReconciliationSchedulerService,
} from '../src/finance/payments/reconciliation-scheduler.service';

interface ApiSuccess<T> {
  success: true;
  data: T;
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
interface InvoicePayload {
  id: string;
  amountPaid: number;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}

/**
 * ReconciliationSchedulerService — the BullMQ repeatable job that automatically triggers
 * PaymentReconciliationService on an interval (see the automation audit report). Everything
 * about WHAT a reconciliation does (provider status handling, idempotence, concurrency guards)
 * is already covered end-to-end in payment-reconciliation.e2e-spec.ts against the real
 * reconcileProcessingPayment()/reconcileProcessingRefund() methods; this file only proves the
 * scheduler actually fires them automatically, on its own, against real MongoDB/Redis — never
 * duplicating that coverage.
 *
 * The scheduler is disabled by default under NODE_ENV=test (see
 * ReconciliationSchedulerService.isEnabled) so it can't fire mid-suite against every other e2e
 * file sharing the same Redis/Mongo. PAYMENT_RECONCILIATION_ENABLED/_INTERVAL_MS are overridden
 * here, for this file's AppModule instance only, and explicitly unset again in afterAll so nothing
 * leaks into whichever e2e file jest runs next in this same worker process.
 */
describe('Payment/Refund reconciliation scheduler (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  let accessToken: string;
  let organizationId: string;
  let contactId: string;

  const intervalMs = 1000;

  beforeAll(async () => {
    process.env.PAYMENT_RECONCILIATION_ENABLED = 'true';
    process.env.PAYMENT_RECONCILIATION_INTERVAL_MS = String(intervalMs);

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
        email: 'scheduler-owner@korva.test',
        password: 'password123',
      })
      .expect(201);
    accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Scheduler Org',
        type: 'service',
        country: 'FR',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        language: 'fr',
      })
      .expect(201);
    organizationId = asSuccess<OrganizationPayload>(orgRes.body).id;

    const contactRes = await request(server)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ firstName: 'Client', lastName: 'Test' })
      .expect(201);
    contactId = asSuccess<ContactPayload>(contactRes.body).id;
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();

    // The BullMQ repeatable schedule lives in Redis, keyed by RECONCILIATION_SCHEDULER_ID, not
    // in-process — closing the app's Worker/Queue does not remove it. Clean it up explicitly so
    // it doesn't keep producing unconsumed jobs in Redis after this file's app has shut down.
    const cleanupConnection = new IORedis(
      process.env.REDIS_URL ?? 'redis://localhost:6380',
      { maxRetriesPerRequest: null },
    );
    const cleanupQueue = new Queue(RECONCILIATION_QUEUE_NAME, {
      connection: cleanupConnection,
    });
    await cleanupQueue.removeJobScheduler(RECONCILIATION_SCHEDULER_ID);
    await cleanupQueue.close();
    cleanupConnection.disconnect();

    delete process.env.PAYMENT_RECONCILIATION_ENABLED;
    delete process.env.PAYMENT_RECONCILIATION_INTERVAL_MS;
  });

  async function createIssuedInvoice(total: number): Promise<string> {
    const invoiceRes = await request(server)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        contactId,
        currency: 'EUR',
        items: [{ description: 'Service', quantity: 1, unitPrice: total }],
      })
      .expect(201);
    const invoiceId = asSuccess<InvoicePayload>(invoiceRes.body).id;

    await request(server)
      .post(`/api/v1/invoices/${invoiceId}/issue`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(201);

    return invoiceId;
  }

  async function insertProcessingPayment(
    invoiceId: string,
    amount: number,
    providerReference?: string,
  ): Promise<string> {
    const paymentsRepository = app.get(PaymentsRepository);
    const payment = await paymentsRepository.createPayment({
      organizationId: new Types.ObjectId(organizationId),
      invoiceId: new Types.ObjectId(invoiceId),
      amount,
      currency: 'EUR',
      status: 'processing',
      provider: 'manual',
      ...(providerReference ? { providerReference } : {}),
    });
    return payment.id as string;
  }

  async function invoiceAmountPaid(invoiceId: string): Promise<number> {
    const res = await request(server)
      .get(`/api/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    return asSuccess<InvoicePayload>(res.body).amountPaid;
  }

  async function waitUntil(
    check: () => Promise<boolean>,
    timeoutMs: number,
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(`waitUntil: condition not met within ${timeoutMs}ms`);
  }

  it(
    'TEST 1 — a Payment left processing with a providerReference is automatically detected and finalized by the scheduled job, with no manual call',
    async () => {
      const invoiceId = await createIssuedInvoice(300);
      const paymentId = await insertProcessingPayment(
        invoiceId,
        200,
        'manual_scheduler_ref_1',
      );

      await waitUntil(async () => {
        const paymentsRepository = app.get(PaymentsRepository);
        const payment = await paymentsRepository.findById(
          organizationId,
          paymentId,
        );
        return payment?.status === 'completed';
      }, intervalMs * 5);

      expect(await invoiceAmountPaid(invoiceId)).toBe(200);
    },
    intervalMs * 6,
  );

  it(
    'TEST 5 — a Payment left processing WITHOUT a providerReference is never queried against the provider by the scheduled job',
    async () => {
      const invoiceId = await createIssuedInvoice(300);
      const paymentId = await insertProcessingPayment(invoiceId, 50);

      const paymentProvider = app.get<PaymentProvider>(PAYMENT_PROVIDER);
      const spy = jest.spyOn(paymentProvider, 'getPaymentStatus');
      const callsBefore = spy.mock.calls.length;

      // Let at least one full tick pass, then assert the provider was never called and the
      // Payment is untouched — this is what proves the job skips unreconcilable candidates
      // (no providerReference) rather than just happening not to reach them yet.
      await new Promise((resolve) => setTimeout(resolve, intervalMs * 2));

      expect(spy.mock.calls.length).toBe(callsBefore);
      const paymentsRepository = app.get(PaymentsRepository);
      const payment = await paymentsRepository.findById(
        organizationId,
        paymentId,
      );
      expect(payment?.status).toBe('processing');
      expect(await invoiceAmountPaid(invoiceId)).toBe(0);

      spy.mockRestore();
    },
    intervalMs * 6,
  );

  it(
    'TEST 4/8 — the job fires repeatedly without re-processing an already-finalized Payment (no double Invoice credit across multiple ticks)',
    async () => {
      const invoiceId = await createIssuedInvoice(300);
      const paymentId = await insertProcessingPayment(
        invoiceId,
        120,
        'manual_scheduler_ref_repeat',
      );

      await waitUntil(async () => {
        const paymentsRepository = app.get(PaymentsRepository);
        const payment = await paymentsRepository.findById(
          organizationId,
          paymentId,
        );
        return payment?.status === 'completed';
      }, intervalMs * 5);
      expect(await invoiceAmountPaid(invoiceId)).toBe(120);

      // Let several more ticks pass — a completed Payment must never be re-finalized.
      await new Promise((resolve) => setTimeout(resolve, intervalMs * 3));
      expect(await invoiceAmountPaid(invoiceId)).toBe(120);
    },
    intervalMs * 9,
  );

  it(
    'TEST 9/11 — a provider error on one candidate does not stop the job from reconciling another candidate in the same or a later tick',
    async () => {
      const goodInvoiceId = await createIssuedInvoice(300);
      const badInvoiceId = await createIssuedInvoice(300);
      const goodPaymentId = await insertProcessingPayment(
        goodInvoiceId,
        80,
        'manual_scheduler_ref_good',
      );
      const badPaymentId = await insertProcessingPayment(
        badInvoiceId,
        90,
        'manual_scheduler_ref_bad',
      );

      const paymentProvider = app.get<PaymentProvider>(PAYMENT_PROVIDER);
      const spy = jest
        .spyOn(paymentProvider, 'getPaymentStatus')
        .mockImplementation((reference: string) => {
          if (reference === 'manual_scheduler_ref_bad') {
            return Promise.reject(new Error('simulated provider outage'));
          }
          return Promise.resolve('completed');
        });

      await waitUntil(async () => {
        const paymentsRepository = app.get(PaymentsRepository);
        const good = await paymentsRepository.findById(
          organizationId,
          goodPaymentId,
        );
        return good?.status === 'completed';
      }, intervalMs * 5);

      expect(await invoiceAmountPaid(goodInvoiceId)).toBe(80);

      const paymentsRepository = app.get(PaymentsRepository);
      const bad = await paymentsRepository.findById(
        organizationId,
        badPaymentId,
      );
      expect(bad?.status).toBe('processing');
      expect(await invoiceAmountPaid(badInvoiceId)).toBe(0);

      spy.mockRestore();
    },
    intervalMs * 6,
  );

  it('TEST 12 — the scheduler shuts down cleanly (worker/queue/Redis connection close without hanging)', async () => {
    // Exercises ReconciliationSchedulerService directly against real Redis, deliberately NOT
    // through a second full AppModule boot: booting/closing the whole app twice in one process
    // has its own unrelated handle-cleanup quirks (Mongoose/other modules) that would make this
    // test about app bootstrapping in general, not about this service's own onModuleDestroy.
    const configService = new ConfigService({
      REDIS_URL: process.env.REDIS_URL,
      PAYMENT_RECONCILIATION_ENABLED: 'true',
      PAYMENT_RECONCILIATION_INTERVAL_MS: '1000',
    });
    const reconciliationStub = {
      reconcilePendingPayments: jest.fn().mockResolvedValue({
        processed: 0,
        completed: 0,
        failed: 0,
        stillProcessing: 0,
        unreconcilable: 0,
      }),
      reconcilePendingRefunds: jest.fn().mockResolvedValue({
        processed: 0,
        completed: 0,
        failed: 0,
        stillProcessing: 0,
        unreconcilable: 0,
      }),
    } as unknown as PaymentReconciliationService;

    const scheduler = new ReconciliationSchedulerService(
      configService,
      reconciliationStub,
    );
    await scheduler.onModuleInit();
    // If onModuleDestroy left the Worker, Queue, or IORedis connection open, this would hang
    // past the test timeout below instead of resolving. Redis-side schedule cleanup (this
    // instance shares RECONCILIATION_SCHEDULER_ID with the file's main `app`) happens once in
    // afterAll, after every test — including this one — has finished with it.
    await scheduler.onModuleDestroy();
  }, 15000);
});
