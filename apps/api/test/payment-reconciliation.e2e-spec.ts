import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PaymentsRepository } from '../src/finance/payments/payments.repository';
import { PaymentsService } from '../src/finance/payments/payments.service';
import { PaymentReconciliationService } from '../src/finance/payments/payment-reconciliation.service';
import { InvoicesService } from '../src/finance/invoices/invoices.service';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from '../src/finance/payments/providers/payment-provider.interface';

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
  status: string;
  total: number;
  amountPaid: number;
}
interface PaymentPayload {
  id: string;
  status: string;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}

/**
 * PaymentReconciliationService — reconciling Payments/Refunds stuck in 'processing' against
 * the payment provider (see the reconciliation audit report for the full architecture).
 *
 * Split into its own spec file rather than appended to finance.e2e-spec.ts: that file's
 * existing tests, plus these, register more orgs via POST /auth/register than the endpoint's
 * AUTH_THROTTLE (30 requests / 60s) allows within one test run. Each e2e spec file boots its
 * own NestApplication with its own in-memory ThrottlerStorage, so a separate file gets a fresh
 * budget — and every test below shares a SINGLE registered org (only one register call for the
 * whole file) since Payment/Refund/Invoice endpoints used for setup aren't throttled at all,
 * making per-test isolation unnecessary at the org level.
 */
describe('Payment/Refund reconciliation (e2e)', () => {
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
      .send({
        email: 'reconciliation-owner@korva.test',
        password: 'password123',
      })
      .expect(201);
    accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Reconciliation Org',
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

  // Simulates "a crash left this Payment stuck in processing with its provider reference
  // already persisted" — the exact precondition PaymentReconciliationService exists for.
  // Constructed directly via the repository (not HTTP) since there is no way to make a real
  // request stop halfway through on purpose; this is standard precondition setup, not a
  // shortcut around the code under test — reconcileProcessingPayment itself runs for real
  // against a real MongoDB rs0 afterwards.
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

  async function createCompletedPayment(
    invoiceId: string,
    amount: number,
  ): Promise<string> {
    const res = await request(server)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ invoiceId, amount, method: 'cash' })
      .expect(201);
    return asSuccess<PaymentPayload>(res.body).id;
  }

  async function insertProcessingRefund(
    paymentId: string,
    amount: number,
    providerReference?: string,
  ): Promise<string> {
    const paymentsRepository = app.get(PaymentsRepository);
    const refund = await paymentsRepository.createRefund({
      organizationId: new Types.ObjectId(organizationId),
      paymentId: new Types.ObjectId(paymentId),
      amount,
      status: 'processing',
      ...(providerReference ? { providerReference } : {}),
    });
    return refund.id as string;
  }

  async function invoiceAmountPaid(invoiceId: string): Promise<number> {
    const res = await request(server)
      .get(`/api/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    return asSuccess<InvoicePayload>(res.body).amountPaid;
  }

  async function paymentByInvoice(
    invoiceId: string,
  ): Promise<PaymentPayload & { refundedAmount: number }> {
    const res = await request(server)
      .get(`/api/v1/payments?invoiceId=${invoiceId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    return asSuccess<(PaymentPayload & { refundedAmount: number })[]>(
      res.body,
    )[0]!;
  }

  it('TEST 1 — Payment processing + provider COMPLETED: Payment completed, Invoice credited exactly once', async () => {
    const invoiceId = await createIssuedInvoice(300);
    const paymentId = await insertProcessingPayment(
      invoiceId,
      200,
      'manual_recon_ref_1',
    );

    const paymentProvider = app.get<PaymentProvider>(PAYMENT_PROVIDER);
    const spy = jest
      .spyOn(paymentProvider, 'getPaymentStatus')
      .mockResolvedValueOnce('completed');

    const paymentsService = app.get(PaymentsService);
    const reconciled = await paymentsService.reconcileProcessingPayment(
      organizationId,
      paymentId,
    );
    expect(reconciled.status).toBe('completed');
    expect(spy).toHaveBeenCalledWith('manual_recon_ref_1');
    expect(await invoiceAmountPaid(invoiceId)).toBe(200);

    spy.mockRestore();
  });

  it('TEST 2 — Payment processing + provider FAILED: Payment failed, Invoice unchanged', async () => {
    const invoiceId = await createIssuedInvoice(300);
    const paymentId = await insertProcessingPayment(
      invoiceId,
      200,
      'manual_recon_ref_2',
    );

    const paymentProvider = app.get<PaymentProvider>(PAYMENT_PROVIDER);
    const spy = jest
      .spyOn(paymentProvider, 'getPaymentStatus')
      .mockResolvedValueOnce('failed');

    const paymentsService = app.get(PaymentsService);
    const reconciled = await paymentsService.reconcileProcessingPayment(
      organizationId,
      paymentId,
    );
    expect(reconciled.status).toBe('failed');
    expect(await invoiceAmountPaid(invoiceId)).toBe(0);

    spy.mockRestore();
  });

  it('TEST 3 — Payment processing + provider UNKNOWN/PENDING: stays processing', async () => {
    const invoiceId = await createIssuedInvoice(300);
    const paymentId = await insertProcessingPayment(
      invoiceId,
      200,
      'manual_recon_ref_3',
    );

    const paymentProvider = app.get<PaymentProvider>(PAYMENT_PROVIDER);
    const spy = jest
      .spyOn(paymentProvider, 'getPaymentStatus')
      .mockResolvedValueOnce('pending');

    const paymentsService = app.get(PaymentsService);
    const reconciled = await paymentsService.reconcileProcessingPayment(
      organizationId,
      paymentId,
    );
    expect(reconciled.status).toBe('processing');
    expect(await invoiceAmountPaid(invoiceId)).toBe(0);

    spy.mockRestore();
  });

  it('TEST 4 — reconciliation executed twice: no double Invoice credit', async () => {
    const invoiceId = await createIssuedInvoice(300);
    const paymentId = await insertProcessingPayment(
      invoiceId,
      200,
      'manual_recon_ref_4',
    );

    const paymentProvider = app.get<PaymentProvider>(PAYMENT_PROVIDER);
    const spy = jest
      .spyOn(paymentProvider, 'getPaymentStatus')
      .mockResolvedValue('completed');

    const paymentsService = app.get(PaymentsService);
    const first = await paymentsService.reconcileProcessingPayment(
      organizationId,
      paymentId,
    );
    const second = await paymentsService.reconcileProcessingPayment(
      organizationId,
      paymentId,
    );
    expect(first.status).toBe('completed');
    expect(second.status).toBe('completed');
    expect(second.id).toBe(first.id);
    // Credited once (200), never twice (400) — run 2 finds the Payment already 'completed' and
    // returns immediately without touching the provider or the Invoice again.
    expect(await invoiceAmountPaid(invoiceId)).toBe(200);

    spy.mockRestore();
  });

  it('TEST 5 — two concurrent reconciliations of the same Payment: exactly one finalization', async () => {
    const invoiceId = await createIssuedInvoice(300);
    const paymentId = await insertProcessingPayment(
      invoiceId,
      200,
      'manual_recon_ref_5',
    );

    const paymentProvider = app.get<PaymentProvider>(PAYMENT_PROVIDER);
    const spy = jest
      .spyOn(paymentProvider, 'getPaymentStatus')
      .mockResolvedValue('completed');

    const paymentsService = app.get(PaymentsService);
    // Dispatched together — a genuine race, not two sequential calls. The guarded finalize
    // inside createCompletedPaymentAtomically (requireStatus: 'processing') is what MongoDB
    // itself arbitrates this on: only one can win.
    const [a, b] = await Promise.all([
      paymentsService.reconcileProcessingPayment(organizationId, paymentId),
      paymentsService.reconcileProcessingPayment(organizationId, paymentId),
    ]);
    expect(a.status).toBe('completed');
    expect(b.status).toBe('completed');
    expect(b.id).toBe(a.id);
    expect(await invoiceAmountPaid(invoiceId)).toBe(200);

    spy.mockRestore();
  });

  it('TEST 6 — Refund processing + provider COMPLETED: Refund completed, Payment.refundedAmount and Invoice adjusted exactly once', async () => {
    const invoiceId = await createIssuedInvoice(300);
    const paymentId = await createCompletedPayment(invoiceId, 300);
    const refundId = await insertProcessingRefund(
      paymentId,
      100,
      'manual_recon_refund_ref_6',
    );

    const paymentProvider = app.get<PaymentProvider>(PAYMENT_PROVIDER);
    const spy = jest
      .spyOn(paymentProvider, 'getPaymentStatus')
      .mockResolvedValueOnce('completed');

    const paymentsService = app.get(PaymentsService);
    const reconciled = await paymentsService.reconcileProcessingRefund(
      organizationId,
      refundId,
    );
    expect(reconciled.status).toBe('completed');
    expect(spy).toHaveBeenCalledWith('manual_recon_refund_ref_6');

    const payment = await paymentByInvoice(invoiceId);
    expect(payment.refundedAmount).toBe(100);
    expect(await invoiceAmountPaid(invoiceId)).toBe(200);

    spy.mockRestore();
  });

  it('TEST 7 — Refund processing + provider FAILED: Refund failed, Payment/Invoice unchanged', async () => {
    const invoiceId = await createIssuedInvoice(300);
    const paymentId = await createCompletedPayment(invoiceId, 300);
    const refundId = await insertProcessingRefund(
      paymentId,
      100,
      'manual_recon_refund_ref_7',
    );

    const paymentProvider = app.get<PaymentProvider>(PAYMENT_PROVIDER);
    const spy = jest
      .spyOn(paymentProvider, 'getPaymentStatus')
      .mockResolvedValueOnce('failed');

    const paymentsService = app.get(PaymentsService);
    const reconciled = await paymentsService.reconcileProcessingRefund(
      organizationId,
      refundId,
    );
    expect(reconciled.status).toBe('failed');

    const payment = await paymentByInvoice(invoiceId);
    expect(payment.refundedAmount).toBe(0);
    expect(await invoiceAmountPaid(invoiceId)).toBe(300);

    spy.mockRestore();
  });

  it('TEST 8 — two concurrent reconciliations of the same Refund: no double adjustment', async () => {
    const invoiceId = await createIssuedInvoice(300);
    const paymentId = await createCompletedPayment(invoiceId, 300);
    const refundId = await insertProcessingRefund(
      paymentId,
      100,
      'manual_recon_refund_ref_8',
    );

    const paymentProvider = app.get<PaymentProvider>(PAYMENT_PROVIDER);
    const spy = jest
      .spyOn(paymentProvider, 'getPaymentStatus')
      .mockResolvedValue('completed');

    const paymentsService = app.get(PaymentsService);
    const [a, b] = await Promise.all([
      paymentsService.reconcileProcessingRefund(organizationId, refundId),
      paymentsService.reconcileProcessingRefund(organizationId, refundId),
    ]);
    expect(a.status).toBe('completed');
    expect(b.status).toBe('completed');
    expect(b.id).toBe(a.id);

    // Adjusted once (100), never twice (200).
    const payment = await paymentByInvoice(invoiceId);
    expect(payment.refundedAmount).toBe(100);
    expect(await invoiceAmountPaid(invoiceId)).toBe(200);

    spy.mockRestore();
  });

  it('TEST 9 — an already-completed Payment is left untouched by reconciliation (no provider call)', async () => {
    const invoiceId = await createIssuedInvoice(300);
    const paymentId = await createCompletedPayment(invoiceId, 200);

    const paymentProvider = app.get<PaymentProvider>(PAYMENT_PROVIDER);
    const spy = jest.spyOn(paymentProvider, 'getPaymentStatus');
    const callsBefore = spy.mock.calls.length;

    const paymentsService = app.get(PaymentsService);
    const reconciled = await paymentsService.reconcileProcessingPayment(
      organizationId,
      paymentId,
    );
    expect(reconciled.status).toBe('completed');
    expect(spy.mock.calls.length - callsBefore).toBe(0);
    expect(await invoiceAmountPaid(invoiceId)).toBe(200);

    spy.mockRestore();
  });

  it('TEST 10/11 — provider unavailable leaves Payment processing with no incorrect write; a later retry with the provider reachable succeeds', async () => {
    const invoiceId = await createIssuedInvoice(300);
    const paymentId = await insertProcessingPayment(
      invoiceId,
      200,
      'manual_recon_ref_10',
    );

    const paymentProvider = app.get<PaymentProvider>(PAYMENT_PROVIDER);
    const paymentsService = app.get(PaymentsService);

    // TEST 10 — network error: leave 'processing', no financial write.
    const failSpy = jest
      .spyOn(paymentProvider, 'getPaymentStatus')
      .mockRejectedValueOnce(new Error('simulated network error'));
    const reconciled = await paymentsService.reconcileProcessingPayment(
      organizationId,
      paymentId,
    );
    expect(reconciled.status).toBe('processing');
    expect(await invoiceAmountPaid(invoiceId)).toBe(0);
    failSpy.mockRestore();

    // TEST 11 — retry with the provider reachable again: succeeds normally, proving the
    // earlier network failure left nothing corrupted or permanently blocked.
    const retrySpy = jest
      .spyOn(paymentProvider, 'getPaymentStatus')
      .mockResolvedValueOnce('completed');
    const retried = await paymentsService.reconcileProcessingPayment(
      organizationId,
      paymentId,
    );
    expect(retried.status).toBe('completed');
    expect(await invoiceAmountPaid(invoiceId)).toBe(200);
    retrySpy.mockRestore();
  });

  it('TEST 12 — crash simulated between reading provider COMPLETED and finalizing Mongo: transaction rolls back, no partial data, a further reconciliation attempt is still possible', async () => {
    const invoiceId = await createIssuedInvoice(300);
    const paymentId = await insertProcessingPayment(
      invoiceId,
      200,
      'manual_recon_ref_12',
    );

    const paymentProvider = app.get<PaymentProvider>(PAYMENT_PROVIDER);
    const providerSpy = jest
      .spyOn(paymentProvider, 'getPaymentStatus')
      .mockResolvedValue('completed');

    // The provider has already answered COMPLETED (providerSpy above) — the failure is
    // injected purely inside the MongoDB transaction that follows, after the guarded Payment
    // finalize has been staged but before the Invoice credit / commit.
    const invoicesService = app.get(InvoicesService);
    const invoiceSpy = jest
      .spyOn(invoicesService, 'applyPaymentIfWithinBalance')
      .mockImplementationOnce(() => {
        throw new Error(
          'deliberate failure to prove reconciliation transaction rollback',
        );
      });

    const paymentsService = app.get(PaymentsService);
    const afterCrash = await paymentsService.reconcileProcessingPayment(
      organizationId,
      paymentId,
    );
    // The Mongo-side error must never be misread as a provider failure — the Payment stays
    // 'processing', not 'failed', since the provider genuinely said COMPLETED.
    expect(afterCrash.status).toBe('processing');
    invoiceSpy.mockRestore();
    expect(await invoiceAmountPaid(invoiceId)).toBe(0);

    // A further reconciliation attempt (invoicesService back to normal) succeeds cleanly.
    const recovered = await paymentsService.reconcileProcessingPayment(
      organizationId,
      paymentId,
    );
    expect(recovered.status).toBe('completed');
    expect(await invoiceAmountPaid(invoiceId)).toBe(200);

    providerSpy.mockRestore();
  });

  it('PaymentReconciliationService.reconcilePendingPayments() finds and reconciles a real candidate via the sweep', async () => {
    const invoiceId = await createIssuedInvoice(300);
    const paymentId = await insertProcessingPayment(
      invoiceId,
      150,
      'manual_recon_sweep_ref',
    );

    const paymentProvider = app.get<PaymentProvider>(PAYMENT_PROVIDER);
    const spy = jest
      .spyOn(paymentProvider, 'getPaymentStatus')
      .mockImplementation((reference: string) =>
        Promise.resolve(
          reference === 'manual_recon_sweep_ref' ? 'completed' : 'processing',
        ),
      );

    const reconciliationService = app.get(PaymentReconciliationService);
    const summary = await reconciliationService.reconcilePendingPayments();
    // >=1, not ===1: other 'processing' Payments from earlier tests in this file may still be
    // sitting in the collection (e.g. TEST 3's, deliberately left unresolved) — the sweep is
    // global, not scoped to this test's own candidate, and correctly leaves those alone too
    // (the mock above only resolves 'manual_recon_sweep_ref' as completed).
    expect(summary.processed).toBeGreaterThanOrEqual(1);

    const paymentsRepository = app.get(PaymentsRepository);
    const payment = await paymentsRepository.findById(
      organizationId,
      paymentId,
    );
    expect(payment?.status).toBe('completed');
    expect(await invoiceAmountPaid(invoiceId)).toBe(150);

    spy.mockRestore();
  });
});
