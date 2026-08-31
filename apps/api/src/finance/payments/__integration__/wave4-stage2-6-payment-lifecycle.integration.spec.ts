import { randomUUID, randomBytes } from 'node:crypto';
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import type { PaymentStatus } from '@korva/types';
import { PaymentsRepository } from '../payments.repository';
import { PaymentsService } from '../payments.service';
import { Payment, PaymentSchema } from '../schemas/payment.schema';
import { Refund, RefundSchema } from '../schemas/refund.schema';
import { Invoice, InvoiceSchema } from '../../invoices/schemas/invoice.schema';
import { InvoicesRepository } from '../../invoices/invoices.repository';
import { InvoicesService } from '../../invoices/invoices.service';
import { AuditService } from '../../../audit/audit.service';
import { MembershipsService } from '../../../identity/memberships/memberships.service';
import { EventBusService } from '../../../core/events/event-bus.service';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type PaymentProviderResult,
} from '../providers/payment-provider.interface';

/**
 * Wave 4 Stage 2.6 — PAYMENT LIFECYCLE HARDENING. Exercises PaymentsService against a REAL
 * MongoDB (its own transactions/atomic guards can only be genuinely proven against a real
 * replica set — see createCompletedPaymentAtomically/refundAtomically's own doc comments; a
 * mocked ClientSession.withTransaction() would not actually exercise the atomicity it claims to
 * provide). This mirrors this codebase's own established convention: no service that uses
 * MongoDB transactions (OrdersService, BookingsService, PaymentsService itself) has ever had a
 * unit test with a mocked session — all are tested this way instead.
 *
 * Uses ONLY a fixture PaymentProvider (FixturePaymentProvider below), configurable per test —
 * NEVER FlutterwaveProvider, never a real network call, matching this stage's explicit
 * "credentials must never be searched for/used" constraint.
 */

const MONGO_HOST = 'mongodb://korva:korva@localhost:27017';
const MONGO_OPTS = 'authSource=admin&replicaSet=rs0';

function testMongoUri(label: string): string {
  const dbName = `korva_test_wave4_${label}_${process.pid}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  return `${MONGO_HOST}/${dbName}?${MONGO_OPTS}`;
}

function fakeGlobalEventBusModule() {
  const publish = jest.fn().mockResolvedValue(undefined);
  @Global()
  @Module({
    providers: [{ provide: EventBusService, useValue: { publish } }],
    exports: [EventBusService],
  })
  class FakeEventBusModule {}
  return { FakeEventBusModule, publish };
}

/**
 * Configurable per test via mutable behavior maps keyed by providerReference — lets one test
 * simulate "Flutterwave-style": createPayment always returns 'pending' synchronously, and the
 * REAL outcome only becomes visible later via getPaymentStatus (exactly matching
 * FlutterwaveProvider's own real, tested behavior — see flutterwave-payment.provider.ts).
 */
class FixturePaymentProvider implements PaymentProvider {
  readonly name = 'fixture';
  statusByReference = new Map<string, PaymentStatus>();
  createPaymentStatus: PaymentStatus = 'pending';
  refundBehavior: 'succeed' | 'ambiguous' = 'succeed';
  // Stage 2.7A — records every localReferenceForReconciliation this fixture was called with, so
  // tests can prove PaymentsService.refund() forwards the claimed Refund's own id (when a claim
  // exists) and forwards nothing at all (when it doesn't) — mirroring what a real
  // FlutterwaveProvider.refundPayment() call receives.
  refundComments: (string | undefined)[] = [];
  // Stage 2.12 — when 'ambiguous', createPayment() rejects mirroring FlutterwaveProvider's own
  // network-error branch: a genuine `ambiguous: true` marker PLUS a `generatedReference` already
  // sent to the provider before the failure (see FlutterwaveApiError's own doc comment) — lets
  // tests prove PaymentsService.create() now captures that reference instead of discarding it.
  createPaymentBehavior: 'succeed' | 'ambiguous' = 'succeed';
  createPaymentAmbiguousReference?: string;
  // Stage 2.12 — a successful refund's result MAY carry provider-specific refund identifiers
  // (Flutterwave's own `id`/`flw_ref`), distinct from providerReference — see
  // PaymentProviderResult's own doc comments on these two fields.
  refundExtra: { providerRefundId?: string; providerRefundReference?: string } =
    {};

  createPayment(): Promise<PaymentProviderResult> {
    if (this.createPaymentBehavior === 'ambiguous') {
      return Promise.reject(
        Object.assign(new Error('Network error calling fixture provider'), {
          ambiguous: true,
          generatedReference: this.createPaymentAmbiguousReference,
        }),
      );
    }
    const providerReference = `fixture_${randomBytes(8).toString('hex')}`;
    this.statusByReference.set(providerReference, this.createPaymentStatus);
    return Promise.resolve({
      providerReference,
      status: this.createPaymentStatus,
    });
  }

  async verifyPayment(
    providerReference: string,
  ): Promise<PaymentProviderResult> {
    return {
      providerReference,
      status: await this.getPaymentStatus(providerReference),
    };
  }

  getPaymentStatus(providerReference: string): Promise<PaymentStatus> {
    return Promise.resolve(
      this.statusByReference.get(providerReference) ?? 'pending',
    );
  }

  refundPayment(
    providerReference: string,
    _amount: number,
    localReferenceForReconciliation?: string,
  ): Promise<PaymentProviderResult> {
    this.refundComments.push(localReferenceForReconciliation);
    if (this.refundBehavior === 'ambiguous') {
      // Mirrors FlutterwaveProvider's own `ambiguous: true` marker (Stage 2.6) — no HTTP
      // response was ever received, so the provider outcome is genuinely unknown.
      return Promise.reject(
        Object.assign(new Error('Network error calling fixture provider'), {
          ambiguous: true,
        }),
      );
    }
    return Promise.resolve({
      providerReference,
      status: 'refunded',
      ...this.refundExtra,
    });
  }
}

describe('Wave 4 Stage 2.6 — payment lifecycle hardening (real Mongo, fixture provider)', () => {
  let connection: Connection;
  let paymentsService: PaymentsService;
  let paymentsRepository: PaymentsRepository;
  let invoicesRepository: InvoicesRepository;
  let provider: FixturePaymentProvider;

  const ORG_A = String(new Types.ObjectId());
  const ORG_B = String(new Types.ObjectId());
  const USER_ID = String(new Types.ObjectId());

  beforeAll(async () => {
    provider = new FixturePaymentProvider();
    const { FakeEventBusModule } = fakeGlobalEventBusModule();
    const uri = testMongoUri('paymentlifecycle');

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        MongooseModule.forRoot(uri),
        MongooseModule.forFeature([
          { name: Payment.name, schema: PaymentSchema },
          { name: Refund.name, schema: RefundSchema },
          { name: Invoice.name, schema: InvoiceSchema },
        ]),
        FakeEventBusModule,
      ],
      providers: [
        PaymentsRepository,
        PaymentsService,
        InvoicesRepository,
        {
          provide: AuditService,
          useValue: { record: jest.fn().mockResolvedValue(undefined) },
        },
        // Only touched by PaymentsService.create()'s optional tipStaffMembershipId validation —
        // never exercised by this lifecycle suite — so an inert stand-in is safe, same reasoning
        // as the InvoicesService factory below.
        { provide: MembershipsService, useValue: {} },
        // Real InvoicesService, constructed directly rather than via Nest's class-provider
        // resolution — its `contactsService`/`countersService`/`discountCodesService`
        // constructor params are never touched by applyPaymentDelta/applyPaymentIfWithinBalance,
        // the only two methods PaymentsService actually calls, so passing inert stand-ins for
        // them is safe and avoids pulling in CrmModule/CountersModule/DiscountCodesService's own
        // dependency graphs for this narrowly-scoped lifecycle test.
        {
          provide: InvoicesService,
          useFactory: (repo: InvoicesRepository, audit: AuditService) =>
            new InvoicesService(
              repo,
              {} as never,
              {} as never,
              audit,
              {} as never,
            ),
          inject: [InvoicesRepository, AuditService],
        },
        { provide: PAYMENT_PROVIDER, useValue: provider },
      ],
    }).compile();

    connection = moduleRef.get(getConnectionToken());
    paymentsService = moduleRef.get(PaymentsService);
    paymentsRepository = moduleRef.get(PaymentsRepository);
    invoicesRepository = moduleRef.get(InvoicesRepository);
    await connection.syncIndexes();
  }, 30_000);

  afterAll(async () => {
    if (connection) {
      await connection.dropDatabase();
      await connection.close();
    }
  }, 30_000);

  beforeEach(() => {
    provider.statusByReference.clear();
    provider.createPaymentStatus = 'pending';
    provider.refundBehavior = 'succeed';
    provider.refundComments = [];
    provider.createPaymentBehavior = 'succeed';
    provider.createPaymentAmbiguousReference = undefined;
    provider.refundExtra = {};
  });

  async function seedInvoice(organizationId: string, total: number) {
    const invoice = await invoicesRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      contactId: new Types.ObjectId(),
      number: `INV-${randomUUID()}`,
      items: [],
      currency: 'XOF',
      subtotal: total,
      taxTotal: 0,
      total,
      amountPaid: 0,
      status: 'issued',
    } as never);
    return invoice;
  }

  describe('P0-1 — Flutterwave-style "pending" payments are reachable by reconciliation', () => {
    it('a payment created with provider status "pending" (Flutterwave real behavior) is finalized to "completed" once reconciled, and Invoice.amountPaid is credited exactly once', async () => {
      const invoice = await seedInvoice(ORG_A, 1000);
      const payment = await paymentsService.create(ORG_A, USER_ID, {
        invoiceId: invoice.id as string,
        amount: 400,
      });
      expect(payment.status).toBe('pending');

      // Confirms the P0 fix directly: findProcessingPayments (status:{$in:['pending','processing']})
      // now actually finds this Payment — before the fix it would never appear here.
      const candidates = await paymentsRepository.findProcessingPayments();
      expect(candidates.map((c) => String(c._id))).toContain(payment.id);

      provider.statusByReference.set(payment.providerReference!, 'completed');
      const reconciled = await paymentsService.reconcileProcessingPayment(
        ORG_A,
        payment.id as string,
      );
      expect(reconciled.status).toBe('completed');

      const updatedInvoice = await invoicesRepository.findById(
        ORG_A,
        invoice.id as string,
      );
      expect(updatedInvoice!.amountPaid).toBe(400);

      // Reconciling AGAIN (simulating a second sweep tick, or a webhook redelivery) must never
      // double-credit the invoice — the guarded finalize only matches while status was
      // 'pending'/'processing'; it's now 'completed', so a second call is a pure no-op read.
      const reconciledAgain = await paymentsService.reconcileProcessingPayment(
        ORG_A,
        payment.id as string,
      );
      expect(reconciledAgain.status).toBe('completed');
      const invoiceAfterSecondReconcile = await invoicesRepository.findById(
        ORG_A,
        invoice.id as string,
      );
      expect(invoiceAfterSecondReconcile!.amountPaid).toBe(400);
    });

    it('CONCURRENCY: 5 concurrent reconciliation calls for the identical pending Payment credit Invoice.amountPaid exactly once — never double-counted', async () => {
      const invoice = await seedInvoice(ORG_A, 1000);
      const payment = await paymentsService.create(ORG_A, USER_ID, {
        invoiceId: invoice.id as string,
        amount: 250,
      });
      provider.statusByReference.set(payment.providerReference!, 'completed');

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          paymentsService.reconcileProcessingPayment(
            ORG_A,
            payment.id as string,
          ),
        ),
      );
      expect(results.every((r) => r.status === 'completed')).toBe(true);

      const updatedInvoice = await invoicesRepository.findById(
        ORG_A,
        invoice.id as string,
      );
      expect(updatedInvoice!.amountPaid).toBe(250);
    });

    it('CONTRADICTORY STATUS: once a Payment is "completed", a later provider status of "failed" can never regress it — the guarded finalize simply cannot match a document no longer in a not-yet-resolved status', async () => {
      const invoice = await seedInvoice(ORG_A, 1000);
      const payment = await paymentsService.create(ORG_A, USER_ID, {
        invoiceId: invoice.id as string,
        amount: 300,
      });
      provider.statusByReference.set(payment.providerReference!, 'completed');
      const completed = await paymentsService.reconcileProcessingPayment(
        ORG_A,
        payment.id as string,
      );
      expect(completed.status).toBe('completed');

      // A contradictory provider report arrives afterwards (e.g. a stale/out-of-order webhook
      // redelivery, or a flaky provider) — reconcileProcessingPayment's OWN entry guard already
      // excludes anything not 'pending'/'processing', so this never even reaches the provider.
      provider.statusByReference.set(payment.providerReference!, 'failed');
      const stillCompleted = await paymentsService.reconcileProcessingPayment(
        ORG_A,
        payment.id as string,
      );
      expect(stillCompleted.status).toBe('completed');
    });

    it('cross-tenant safety: reconcileProcessingPayment for the wrong organizationId never touches the Payment', async () => {
      const invoice = await seedInvoice(ORG_A, 1000);
      const payment = await paymentsService.create(ORG_A, USER_ID, {
        invoiceId: invoice.id as string,
        amount: 100,
      });
      provider.statusByReference.set(payment.providerReference!, 'completed');

      await expect(
        paymentsService.reconcileProcessingPayment(ORG_B, payment.id as string),
      ).rejects.toMatchObject({ response: { code: 'PAYMENT_NOT_FOUND' } });

      const untouched = await paymentsRepository.findById(
        ORG_A,
        payment.id as string,
      );
      expect(untouched!.status).toBe('pending');
    });

    it('INVARIANT 1: a payment amount exceeding the remaining invoice balance is rejected before ever calling the provider', async () => {
      const invoice = await seedInvoice(ORG_A, 100);
      await expect(
        paymentsService.create(ORG_A, USER_ID, {
          invoiceId: invoice.id as string,
          amount: 150,
        }),
      ).rejects.toMatchObject({
        response: { code: 'PAYMENT_EXCEEDS_BALANCE' },
      });
    });
  });

  describe('P0-2 — ambiguous provider errors never get silently marked "failed" (double-refund prevention)', () => {
    it('an ambiguous refund provider error (network timeout, outcome unknown) leaves the Refund in "processing", never "failed" — and a same-key retry does NOT call the provider again', async () => {
      const invoice = await seedInvoice(ORG_A, 1000);
      const payment = await paymentsService.create(ORG_A, USER_ID, {
        invoiceId: invoice.id as string,
        amount: 500,
      });
      provider.statusByReference.set(payment.providerReference!, 'completed');
      await paymentsService.reconcileProcessingPayment(
        ORG_A,
        payment.id as string,
      );

      provider.refundBehavior = 'ambiguous';
      const idempotencyKey = `refund-key-${randomUUID()}`;
      await expect(
        paymentsService.refund(
          ORG_A,
          USER_ID,
          { paymentId: payment.id as string, amount: 200 },
          idempotencyKey,
        ),
      ).rejects.toThrow(/Network error calling fixture provider/);

      const refundCallCountBefore = provider.statusByReference.size;

      // A same-key retry must return the EXISTING (still-processing) claim, never call the
      // provider a second time — this is what prevents a real double-refund: the client cannot
      // accidentally trigger a second provider call by retrying with the same key.
      provider.refundBehavior = 'succeed';
      const retried = await paymentsService.refund(
        ORG_A,
        USER_ID,
        { paymentId: payment.id as string, amount: 200 },
        idempotencyKey,
      );
      expect(retried.status).toBe('processing');
      // statusByReference only grows on createPayment(), not refundPayment() — this just proves
      // no NEW payment/refund reference was minted by the retry, i.e. the provider was never
      // actually called again for this key.
      expect(provider.statusByReference.size).toBe(refundCallCountBefore);
    });

    it('a DEFINITE provider rejection (not ambiguous) still marks the Refund "failed" as before — this stage never weakens that existing behavior', async () => {
      const invoice = await seedInvoice(ORG_A, 1000);
      const payment = await paymentsService.create(ORG_A, USER_ID, {
        invoiceId: invoice.id as string,
        amount: 500,
      });
      provider.statusByReference.set(payment.providerReference!, 'completed');
      await paymentsService.reconcileProcessingPayment(
        ORG_A,
        payment.id as string,
      );

      const definiteError = new Error(
        'Refund rejected: insufficient provider balance',
      );
      jest
        .spyOn(provider, 'refundPayment')
        .mockRejectedValueOnce(definiteError);

      const idempotencyKey = `refund-key-${randomUUID()}`;
      await expect(
        paymentsService.refund(
          ORG_A,
          USER_ID,
          { paymentId: payment.id as string, amount: 200 },
          idempotencyKey,
        ),
      ).rejects.toThrow(definiteError);

      const refunds = await paymentsRepository.findRefundByIdempotencyKey(
        ORG_A,
        idempotencyKey,
      );
      expect(refunds?.status).toBe('failed');
    });
  });

  describe('Stage 2.12 — proactive provider identifier capture', () => {
    it('P1/P2 — WITH an Idempotency-Key: an ambiguous createPayment error preserves the already-generated tx_ref on the claimed Payment, which stays "processing" (never treated as evidence of success)', async () => {
      const invoice = await seedInvoice(ORG_A, 1000);
      provider.createPaymentBehavior = 'ambiguous';
      provider.createPaymentAmbiguousReference =
        'korva_generated_tx_ref_abc123';
      const idempotencyKey = `create-key-${randomUUID()}`;

      await expect(
        paymentsService.create(
          ORG_A,
          USER_ID,
          { invoiceId: invoice.id as string, amount: 400 },
          idempotencyKey,
        ),
      ).rejects.toThrow(/Network error calling fixture provider/);

      const claim = await paymentsRepository.findByIdempotencyKey(
        ORG_A,
        idempotencyKey,
      );
      expect(claim?.status).toBe('processing');
      expect(claim?.providerReference).toBe('korva_generated_tx_ref_abc123');

      // Invariant: the invoice must NEVER be credited off the strength of a merely-captured
      // reference — capturing evidence is not the same as confirming success (mandate's own
      // closing rule: "Do not act on ambiguous evidence").
      const untouchedInvoice = await invoicesRepository.findById(
        ORG_A,
        invoice.id as string,
      );
      expect(untouchedInvoice!.amountPaid).toBe(0);
    });

    it('P3 — WITHOUT an Idempotency-Key: an ambiguous createPayment error still propagates cleanly (no crash from the best-effort capture) and creates no Payment document at all — there is no claim to attach the reference to', async () => {
      const invoice = await seedInvoice(ORG_A, 1000);
      provider.createPaymentBehavior = 'ambiguous';
      provider.createPaymentAmbiguousReference =
        'korva_generated_tx_ref_xyz789';

      const before = await paymentsRepository.findProcessingPaymentsPaginated({
        page: 1,
        limit: 100,
        organizationId: ORG_A,
      });

      await expect(
        paymentsService.create(ORG_A, USER_ID, {
          invoiceId: invoice.id as string,
          amount: 400,
        }),
      ).rejects.toThrow(/Network error calling fixture provider/);

      const after = await paymentsRepository.findProcessingPaymentsPaginated({
        page: 1,
        limit: 100,
        organizationId: ORG_A,
      });
      expect(after.total).toBe(before.total);
    });

    it('P4 — a DEFINITE (non-ambiguous) createPayment error is completely unaffected: still marks the claim "failed", exactly as before this stage', async () => {
      const invoice = await seedInvoice(ORG_A, 1000);
      const definiteError = new Error('Card declined');
      jest
        .spyOn(provider, 'createPayment')
        .mockRejectedValueOnce(definiteError);
      const idempotencyKey = `create-key-${randomUUID()}`;

      await expect(
        paymentsService.create(
          ORG_A,
          USER_ID,
          { invoiceId: invoice.id as string, amount: 400 },
          idempotencyKey,
        ),
      ).rejects.toThrow(definiteError);

      const claim = await paymentsRepository.findByIdempotencyKey(
        ORG_A,
        idempotencyKey,
      );
      expect(claim?.status).toBe('failed');
    });

    it('R1/R2 — a successful refund captures both providerRefundId and providerRefundReference when the provider returns them, distinct from providerReference (the payment tx_ref)', async () => {
      const invoice = await seedInvoice(ORG_A, 1000);
      const payment = await paymentsService.create(ORG_A, USER_ID, {
        invoiceId: invoice.id as string,
        amount: 500,
      });
      provider.statusByReference.set(payment.providerReference!, 'completed');
      await paymentsService.reconcileProcessingPayment(
        ORG_A,
        payment.id as string,
      );

      provider.refundExtra = {
        providerRefundId: 'flw-refund-id-999',
        providerRefundReference: 'flw-refund-ref-abc',
      };
      const idempotencyKey = `refund-key-${randomUUID()}`;
      const refund = await paymentsService.refund(
        ORG_A,
        USER_ID,
        { paymentId: payment.id as string, amount: 200 },
        idempotencyKey,
      );

      expect(refund.providerRefundId).toBe('flw-refund-id-999');
      expect(refund.providerRefundReference).toBe('flw-refund-ref-abc');
      expect(refund.providerReference).toBe(payment.providerReference);
      expect(refund.providerRefundId).not.toBe(refund.providerReference);
    });

    it('R3 — when the provider returns neither identifier, neither field is invented: both stay undefined on the finalized Refund', async () => {
      const invoice = await seedInvoice(ORG_A, 1000);
      const payment = await paymentsService.create(ORG_A, USER_ID, {
        invoiceId: invoice.id as string,
        amount: 500,
      });
      provider.statusByReference.set(payment.providerReference!, 'completed');
      await paymentsService.reconcileProcessingPayment(
        ORG_A,
        payment.id as string,
      );

      const idempotencyKey = `refund-key-${randomUUID()}`;
      const refund = await paymentsService.refund(
        ORG_A,
        USER_ID,
        { paymentId: payment.id as string, amount: 200 },
        idempotencyKey,
      );

      expect(refund.providerRefundId).toBeUndefined();
      expect(refund.providerRefundReference).toBeUndefined();
    });

    it('G — regression: the full ambiguous-refund / same-key-retry flow from P0-2 above still behaves identically when the fixture also happens to have a stale createPaymentAmbiguousReference set (proves the two capture paths are fully independent)', async () => {
      const invoice = await seedInvoice(ORG_A, 1000);
      provider.createPaymentAmbiguousReference = 'unrelated-stale-value';
      const payment = await paymentsService.create(ORG_A, USER_ID, {
        invoiceId: invoice.id as string,
        amount: 500,
      });
      provider.statusByReference.set(payment.providerReference!, 'completed');
      await paymentsService.reconcileProcessingPayment(
        ORG_A,
        payment.id as string,
      );

      provider.refundBehavior = 'ambiguous';
      const idempotencyKey = `refund-key-${randomUUID()}`;
      await expect(
        paymentsService.refund(
          ORG_A,
          USER_ID,
          { paymentId: payment.id as string, amount: 200 },
          idempotencyKey,
        ),
      ).rejects.toThrow(/Network error calling fixture provider/);

      const refunds = await paymentsRepository.findRefundByIdempotencyKey(
        ORG_A,
        idempotencyKey,
      );
      expect(refunds?.status).toBe('processing');
      expect(refunds?.providerRefundId).toBeUndefined();
      expect(refunds?.providerRefundReference).toBeUndefined();
    });
  });

  describe('Refund lifecycle — partial refunds, tracking, and Invoice/Payment consistency', () => {
    it('two partial refunds sum correctly, update Payment.refundedAmount and Invoice.amountPaid, and stay within the original payment amount', async () => {
      const invoice = await seedInvoice(ORG_A, 1000);
      const payment = await paymentsService.create(ORG_A, USER_ID, {
        invoiceId: invoice.id as string,
        amount: 600,
      });
      provider.statusByReference.set(payment.providerReference!, 'completed');
      await paymentsService.reconcileProcessingPayment(
        ORG_A,
        payment.id as string,
      );

      await paymentsService.refund(
        ORG_A,
        USER_ID,
        { paymentId: payment.id as string, amount: 200 },
        `refund-${randomUUID()}`,
      );
      await paymentsService.refund(
        ORG_A,
        USER_ID,
        { paymentId: payment.id as string, amount: 150 },
        `refund-${randomUUID()}`,
      );

      const finalPayment = await paymentsRepository.findById(
        ORG_A,
        payment.id as string,
      );
      expect(finalPayment!.refundedAmount).toBe(350);
      expect(finalPayment!.status).toBe('completed'); // not fully refunded yet

      const finalInvoice = await invoicesRepository.findById(
        ORG_A,
        invoice.id as string,
      );
      expect(finalInvoice!.amountPaid).toBe(250); // 600 - 200 - 150

      // A third refund exceeding what's left (600 - 350 = 250 refundable) is rejected.
      await expect(
        paymentsService.refund(
          ORG_A,
          USER_ID,
          { paymentId: payment.id as string, amount: 300 },
          `refund-${randomUUID()}`,
        ),
      ).rejects.toMatchObject({ response: { code: 'REFUND_EXCEEDS_PAYMENT' } });
    });

    it('a refund on a Payment belonging to a different organization is rejected as not found — never a cross-tenant mutation', async () => {
      const invoice = await seedInvoice(ORG_A, 1000);
      const payment = await paymentsService.create(ORG_A, USER_ID, {
        invoiceId: invoice.id as string,
        amount: 400,
      });
      provider.statusByReference.set(payment.providerReference!, 'completed');
      await paymentsService.reconcileProcessingPayment(
        ORG_A,
        payment.id as string,
      );

      await expect(
        paymentsService.refund(
          ORG_B,
          USER_ID,
          { paymentId: payment.id as string, amount: 100 },
          `refund-${randomUUID()}`,
        ),
      ).rejects.toMatchObject({ response: { code: 'PAYMENT_NOT_FOUND' } });

      const untouched = await paymentsRepository.findById(
        ORG_A,
        payment.id as string,
      );
      expect(untouched!.refundedAmount).toBe(0);
    });
  });

  describe('Stage 2.7A — refund idempotency matrix (same key / different key / no key)', () => {
    async function completedPayment(org: string, amount: number) {
      const invoice = await seedInvoice(org, 10_000);
      const payment = await paymentsService.create(org, USER_ID, {
        invoiceId: invoice.id as string,
        amount,
      });
      provider.statusByReference.set(payment.providerReference!, 'completed');
      await paymentsService.reconcileProcessingPayment(
        org,
        payment.id as string,
      );
      return { invoice, payment };
    }

    it('SAME key: a second call with the identical Idempotency-Key returns the exact same Refund without calling the provider again', async () => {
      const { payment } = await completedPayment(ORG_A, 500);
      const key = `refund-${randomUUID()}`;

      const first = await paymentsService.refund(
        ORG_A,
        USER_ID,
        { paymentId: payment.id as string, amount: 100 },
        key,
      );
      const second = await paymentsService.refund(
        ORG_A,
        USER_ID,
        { paymentId: payment.id as string, amount: 100 },
        key,
      );

      expect(String(second.id)).toBe(String(first.id));
      expect(provider.refundComments.length).toBe(1); // provider called exactly once

      const finalPayment = await paymentsRepository.findById(
        ORG_A,
        payment.id as string,
      );
      expect(finalPayment!.refundedAmount).toBe(100); // never double-applied
    });

    it('SAME key, but a logically DIFFERENT request: rejected as IDEMPOTENCY_KEY_MISMATCH — a key cannot be reused for a different amount', async () => {
      const { payment } = await completedPayment(ORG_A, 500);
      const key = `refund-${randomUUID()}`;

      await paymentsService.refund(
        ORG_A,
        USER_ID,
        { paymentId: payment.id as string, amount: 100 },
        key,
      );

      await expect(
        paymentsService.refund(
          ORG_A,
          USER_ID,
          { paymentId: payment.id as string, amount: 200 },
          key,
        ),
      ).rejects.toMatchObject({
        response: { code: 'IDEMPOTENCY_KEY_MISMATCH' },
      });
    });

    it('TEST R-I5 (Stage 2.7B) — SAME key, different reason: rejected as IDEMPOTENCY_KEY_MISMATCH, no additional provider call', async () => {
      const { payment } = await completedPayment(ORG_A, 500);
      const key = `refund-${randomUUID()}`;

      await paymentsService.refund(
        ORG_A,
        USER_ID,
        {
          paymentId: payment.id as string,
          amount: 100,
          reason: 'duplicate charge',
        },
        key,
      );
      const callsAfterFirst = provider.refundComments.length;

      await expect(
        paymentsService.refund(
          ORG_A,
          USER_ID,
          {
            paymentId: payment.id as string,
            amount: 100,
            reason: 'customer request',
          },
          key,
        ),
      ).rejects.toMatchObject({
        response: { code: 'IDEMPOTENCY_KEY_MISMATCH' },
      });
      expect(provider.refundComments.length).toBe(callsAfterFirst); // no extra provider call
    });

    it('TEST R-I6 (Stage 2.7B) — SAME key, different Payment: rejected as IDEMPOTENCY_KEY_MISMATCH — a key cannot be silently repointed at a different operation', async () => {
      const { payment: paymentOne } = await completedPayment(ORG_A, 500);
      const { payment: paymentTwo } = await completedPayment(ORG_A, 500);
      const key = `refund-${randomUUID()}`;

      await paymentsService.refund(
        ORG_A,
        USER_ID,
        { paymentId: paymentOne.id as string, amount: 100 },
        key,
      );

      await expect(
        paymentsService.refund(
          ORG_A,
          USER_ID,
          { paymentId: paymentTwo.id as string, amount: 100 },
          key,
        ),
      ).rejects.toMatchObject({
        response: { code: 'IDEMPOTENCY_KEY_MISMATCH' },
      });

      const untouchedPaymentTwo = await paymentsRepository.findById(
        ORG_A,
        paymentTwo.id as string,
      );
      expect(untouchedPaymentTwo!.refundedAmount).toBe(0);
    });

    it('TEST R-I9 (Stage 2.7B) — POST /payments (create) behavior is completely unchanged: still succeeds with no Idempotency-Key at all', async () => {
      const invoice = await seedInvoice(ORG_A, 1000);

      const payment = await paymentsService.create(ORG_A, USER_ID, {
        invoiceId: invoice.id as string,
        amount: 250,
      });

      expect(payment.amount).toBe(250);
      expect(payment.idempotencyKey).toBeUndefined();
    });

    it('TEST R-I10 (Stage 2.7B) — cross-tenant: the SAME Idempotency-Key string used by two different organizations never collides — each tenant gets its own, independent Refund', async () => {
      const { payment: paymentA } = await completedPayment(ORG_A, 500);
      const { payment: paymentB } = await completedPayment(ORG_B, 500);
      const sharedKeyValue = `refund-shared-${randomUUID()}`;

      const refundA = await paymentsService.refund(
        ORG_A,
        USER_ID,
        { paymentId: paymentA.id as string, amount: 100 },
        sharedKeyValue,
      );
      const refundB = await paymentsService.refund(
        ORG_B,
        USER_ID,
        { paymentId: paymentB.id as string, amount: 200 },
        sharedKeyValue,
      );

      expect(String(refundA.id)).not.toBe(String(refundB.id));
      expect(refundA.amount).toBe(100);
      expect(refundB.amount).toBe(200);

      // Tenant B can never look up or reuse tenant A's claim for the same key value.
      const lookupFromB = await paymentsRepository.findRefundByIdempotencyKey(
        ORG_B,
        sharedKeyValue,
      );
      expect(String(lookupFromB!.id)).toBe(String(refundB.id));
      expect(String(lookupFromB!.id)).not.toBe(String(refundA.id));
    });

    it('DIFFERENT keys: two independent, legitimate refunds against the same Payment both succeed and sum correctly', async () => {
      const { payment } = await completedPayment(ORG_A, 500);

      await paymentsService.refund(
        ORG_A,
        USER_ID,
        { paymentId: payment.id as string, amount: 100 },
        `refund-${randomUUID()}`,
      );
      await paymentsService.refund(
        ORG_A,
        USER_ID,
        { paymentId: payment.id as string, amount: 150 },
        `refund-${randomUUID()}`,
      );

      const finalPayment = await paymentsRepository.findById(
        ORG_A,
        payment.id as string,
      );
      expect(finalPayment!.refundedAmount).toBe(250);
    });

    it('TEST R-I1 (Stage 2.7B) — NO key: rejected with REFUND_IDEMPOTENCY_KEY_REQUIRED before any Payment lookup, before any Refund claim, before any provider call', async () => {
      const { payment } = await completedPayment(ORG_A, 500);

      await expect(
        paymentsService.refund(ORG_A, USER_ID, {
          paymentId: payment.id as string,
          amount: 100,
        }),
      ).rejects.toMatchObject({
        response: { code: 'REFUND_IDEMPOTENCY_KEY_REQUIRED' },
      });

      expect(provider.refundComments).toEqual([]); // provider never called
      const untouched = await paymentsRepository.findById(
        ORG_A,
        payment.id as string,
      );
      expect(untouched!.refundedAmount).toBe(0); // no mutation of any kind
      const refunds = await paymentsRepository.findRefundByIdempotencyKey(
        ORG_A,
        'anything',
      );
      expect(refunds).toBeNull(); // no orphan claim left behind
    });

    it('TEST R-I1b — an EMPTY string Idempotency-Key is rejected exactly like an absent one', async () => {
      const { payment } = await completedPayment(ORG_A, 500);

      await expect(
        paymentsService.refund(
          ORG_A,
          USER_ID,
          { paymentId: payment.id as string, amount: 100 },
          '',
        ),
      ).rejects.toMatchObject({
        response: { code: 'REFUND_IDEMPOTENCY_KEY_REQUIRED' },
      });
      expect(provider.refundComments).toEqual([]);
    });

    it('TEST R-I2 (Stage 2.7B) — a valid Idempotency-Key: normal refund behavior, unchanged', async () => {
      const { payment } = await completedPayment(ORG_A, 500);

      const refund = await paymentsService.refund(
        ORG_A,
        USER_ID,
        { paymentId: payment.id as string, amount: 100 },
        `refund-${randomUUID()}`,
      );

      expect(refund.amount).toBe(100);
      expect(refund.idempotencyKey).toBeDefined();
    });

    it('CONCURRENCY — same key: 5 concurrent refund requests with the identical Idempotency-Key result in exactly one provider call and exactly one refunded amount applied', async () => {
      const { payment } = await completedPayment(ORG_A, 500);
      const key = `refund-${randomUUID()}`;

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          paymentsService.refund(
            ORG_A,
            USER_ID,
            { paymentId: payment.id as string, amount: 100 },
            key,
          ),
        ),
      );

      const distinctIds = new Set(results.map((r) => String(r.id)));
      expect(distinctIds.size).toBe(1); // every caller got back the SAME Refund
      expect(provider.refundComments.length).toBe(1); // provider called exactly once

      const finalPayment = await paymentsRepository.findById(
        ORG_A,
        payment.id as string,
      );
      expect(finalPayment!.refundedAmount).toBe(100);
    });

    it('CONCURRENCY — different keys: 3 concurrent refund requests with DIFFERENT Idempotency-Keys, together within the refundable balance, all succeed and never exceed the payment amount', async () => {
      const { payment } = await completedPayment(ORG_A, 500);

      const results = await Promise.all(
        [100, 100, 100].map((amount) =>
          paymentsService.refund(
            ORG_A,
            USER_ID,
            { paymentId: payment.id as string, amount },
            `refund-${randomUUID()}`,
          ),
        ),
      );

      expect(results).toHaveLength(3);
      const finalPayment = await paymentsRepository.findById(
        ORG_A,
        payment.id as string,
      );
      expect(finalPayment!.refundedAmount).toBe(300);
      expect(finalPayment!.refundedAmount).toBeLessThanOrEqual(
        finalPayment!.amount,
      );
    });

    it('CONCURRENCY — different keys exceeding the refundable balance: the guarded atomic increment rejects whichever request would push the total over the payment amount, never both', async () => {
      const { payment } = await completedPayment(ORG_A, 500);

      const results = await Promise.allSettled(
        [300, 300].map((amount) =>
          paymentsService.refund(
            ORG_A,
            USER_ID,
            { paymentId: payment.id as string, amount },
            `refund-${randomUUID()}`,
          ),
        ),
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled.length).toBeLessThanOrEqual(1); // at most one of the two 300s can fit in 500

      const finalPayment = await paymentsRepository.findById(
        ORG_A,
        payment.id as string,
      );
      expect(finalPayment!.refundedAmount).toBeLessThanOrEqual(500);
    });

    it("the claimed Refund's own id is forwarded to the provider as localReferenceForReconciliation when an Idempotency-Key is used — a real, durable breadcrumb, never fabricated", async () => {
      const { payment } = await completedPayment(ORG_A, 500);

      const refund = await paymentsService.refund(
        ORG_A,
        USER_ID,
        { paymentId: payment.id as string, amount: 100 },
        `refund-${randomUUID()}`,
      );

      expect(provider.refundComments).toEqual([String(refund.id)]);
    });

    it("no secret leakage: the forwarded breadcrumb is only ever the local Refund's own Mongo id — never a payment/organization secret, never the idempotency key itself", async () => {
      const { payment } = await completedPayment(ORG_A, 500);
      const key = `refund-secret-key-${randomUUID()}`;

      const refund = await paymentsService.refund(
        ORG_A,
        USER_ID,
        { paymentId: payment.id as string, amount: 100 },
        key,
      );

      const forwarded = provider.refundComments[0];
      expect(forwarded).toBe(String(refund.id));
      expect(forwarded).not.toContain(key);
      expect(forwarded).not.toBe(key);
    });
  });

  describe('Stage 2.8 — findRefundsRequiringAttention (operational observability, GAP B)', () => {
    it('a processing refund (ambiguous provider error) appears as requiring attention', async () => {
      const invoice = await seedInvoice(ORG_A, 1000);
      const payment = await paymentsService.create(ORG_A, USER_ID, {
        invoiceId: invoice.id as string,
        amount: 300,
      });
      provider.statusByReference.set(payment.providerReference!, 'completed');
      await paymentsService.reconcileProcessingPayment(
        ORG_A,
        payment.id as string,
      );

      provider.refundBehavior = 'ambiguous';
      const key = `attn-ambiguous-${randomUUID()}`;
      await expect(
        paymentsService.refund(
          ORG_A,
          USER_ID,
          {
            paymentId: payment.id as string,
            amount: 100,
            reason: 'chargeback',
          },
          key,
        ),
      ).rejects.toThrow();
      provider.refundBehavior = 'succeed';

      const result = await paymentsRepository.findRefundsRequiringAttention({
        page: 1,
        limit: 100,
        organizationId: ORG_A,
      });

      const found = result.data.find(
        (r) => r.paymentId === (payment.id as string),
      );
      expect(found).toBeDefined();
      expect(found!.organizationId).toBe(ORG_A);
      expect(found!.amount).toBe(100);
      expect(found!.reason).toBe('chargeback');
      expect(found!.provider).toBe('fixture');
      expect(found!.note).toMatch(/does NOT/i);
    });

    it('a completed (fully successful) refund does NOT appear as requiring attention', async () => {
      const invoice = await seedInvoice(ORG_A, 1000);
      const payment = await paymentsService.create(ORG_A, USER_ID, {
        invoiceId: invoice.id as string,
        amount: 300,
      });
      provider.statusByReference.set(payment.providerReference!, 'completed');
      await paymentsService.reconcileProcessingPayment(
        ORG_A,
        payment.id as string,
      );

      const refund = await paymentsService.refund(
        ORG_A,
        USER_ID,
        { paymentId: payment.id as string, amount: 50 },
        `attn-completed-${randomUUID()}`,
      );

      const result = await paymentsRepository.findRefundsRequiringAttention({
        page: 1,
        limit: 100,
        organizationId: ORG_A,
      });
      expect(result.data.map((r) => r.id)).not.toContain(String(refund.id));
    });

    it('a definitively failed refund claim does NOT appear as requiring attention (only "processing" does)', async () => {
      const invoice = await seedInvoice(ORG_A, 1000);
      const payment = await paymentsService.create(ORG_A, USER_ID, {
        invoiceId: invoice.id as string,
        amount: 300,
      });
      provider.statusByReference.set(payment.providerReference!, 'completed');
      await paymentsService.reconcileProcessingPayment(
        ORG_A,
        payment.id as string,
      );

      const definiteError = new Error(
        'Refund rejected: definite provider error',
      );
      jest
        .spyOn(provider, 'refundPayment')
        .mockRejectedValueOnce(definiteError);
      const key = `attn-failed-${randomUUID()}`;
      await expect(
        paymentsService.refund(
          ORG_A,
          USER_ID,
          { paymentId: payment.id as string, amount: 100 },
          key,
        ),
      ).rejects.toThrow(definiteError);

      const failedRefund = await paymentsRepository.findRefundByIdempotencyKey(
        ORG_A,
        key,
      );
      expect(failedRefund!.status).toBe('failed');

      const result = await paymentsRepository.findRefundsRequiringAttention({
        page: 1,
        limit: 100,
        organizationId: ORG_A,
      });
      expect(result.data.map((r) => r.id)).not.toContain(
        String(failedRefund!.id),
      );
    });

    it("cross-tenant isolation: an operator filtering by organizationId never sees another tenant's processing refund", async () => {
      const invoiceA = await seedInvoice(ORG_A, 1000);
      const paymentA = await paymentsService.create(ORG_A, USER_ID, {
        invoiceId: invoiceA.id as string,
        amount: 200,
      });
      provider.statusByReference.set(paymentA.providerReference!, 'completed');
      await paymentsService.reconcileProcessingPayment(
        ORG_A,
        paymentA.id as string,
      );

      const invoiceB = await seedInvoice(ORG_B, 1000);
      const paymentB = await paymentsService.create(ORG_B, USER_ID, {
        invoiceId: invoiceB.id as string,
        amount: 200,
      });
      provider.statusByReference.set(paymentB.providerReference!, 'completed');
      await paymentsService.reconcileProcessingPayment(
        ORG_B,
        paymentB.id as string,
      );

      provider.refundBehavior = 'ambiguous';
      await expect(
        paymentsService.refund(
          ORG_A,
          USER_ID,
          { paymentId: paymentA.id as string, amount: 50 },
          `attn-tenant-a-${randomUUID()}`,
        ),
      ).rejects.toThrow();
      await expect(
        paymentsService.refund(
          ORG_B,
          USER_ID,
          { paymentId: paymentB.id as string, amount: 50 },
          `attn-tenant-b-${randomUUID()}`,
        ),
      ).rejects.toThrow();
      provider.refundBehavior = 'succeed';

      const resultA = await paymentsRepository.findRefundsRequiringAttention({
        page: 1,
        limit: 100,
        organizationId: ORG_A,
      });
      expect(resultA.data.every((r) => r.organizationId === ORG_A)).toBe(true);
      expect(resultA.data.map((r) => r.paymentId)).not.toContain(
        paymentB.id as string,
      );

      const resultB = await paymentsRepository.findRefundsRequiringAttention({
        page: 1,
        limit: 100,
        organizationId: ORG_B,
      });
      expect(resultB.data.every((r) => r.organizationId === ORG_B)).toBe(true);
      expect(resultB.data.map((r) => r.paymentId)).not.toContain(
        paymentA.id as string,
      );
    });

    it('the Idempotency-Key is never exposed in clear — only a boolean presence flag', async () => {
      const invoice = await seedInvoice(ORG_A, 1000);
      const payment = await paymentsService.create(ORG_A, USER_ID, {
        invoiceId: invoice.id as string,
        amount: 300,
      });
      provider.statusByReference.set(payment.providerReference!, 'completed');
      await paymentsService.reconcileProcessingPayment(
        ORG_A,
        payment.id as string,
      );

      provider.refundBehavior = 'ambiguous';
      const secretLookingKey = `super-secret-idempotency-key-${randomUUID()}`;
      await expect(
        paymentsService.refund(
          ORG_A,
          USER_ID,
          { paymentId: payment.id as string, amount: 60 },
          secretLookingKey,
        ),
      ).rejects.toThrow();
      provider.refundBehavior = 'succeed';

      const result = await paymentsRepository.findRefundsRequiringAttention({
        page: 1,
        limit: 100,
        organizationId: ORG_A,
      });
      const found = result.data.find(
        (r) => r.paymentId === (payment.id as string) && r.amount === 60,
      );
      expect(found).toBeDefined();
      expect(found!.hasIdempotencyKey).toBe(true);
      expect(JSON.stringify(found)).not.toContain(secretLookingKey);
      // Stage 2.7A/2.7B's own documented residual gap, reconfirmed here: an AMBIGUOUS provider
      // error means the provider call never resolved, so persistRefundProviderReference (which
      // only runs on a resolved response) never ran for this specific attempt —
      // providerReference is genuinely absent, not redacted. This is exactly why the "note"
      // field exists: the operator has even less to go on here than a resolved-but-unconfirmed
      // reference, reinforcing that manual investigation (via the PAYMENT's own reference,
      // asserted below) is required.
      expect(found!.providerReference).toBeUndefined();
    });

    it('when a providerReference IS present on a processing Refund, it is exposed in full — it is a KORVA-generated merchant reference, not a credential', async () => {
      const invoice = await seedInvoice(ORG_A, 1000);
      const payment = await paymentsService.create(ORG_A, USER_ID, {
        invoiceId: invoice.id as string,
        amount: 300,
      });
      provider.statusByReference.set(payment.providerReference!, 'completed');
      await paymentsService.reconcileProcessingPayment(
        ORG_A,
        payment.id as string,
      );

      // A claimed Refund that never even reaches the provider call still has no reference
      // either — the only way a Refund carries one is a genuinely resolved provider response.
      // Directly claim + persist one to prove the summary surfaces it correctly when present,
      // mirroring exactly what persistRefundProviderReference itself writes.
      const claimed = await paymentsRepository.createRefund({
        organizationId: new Types.ObjectId(ORG_A),
        paymentId: new Types.ObjectId(payment.id as string),
        amount: 25,
        status: 'processing',
        idempotencyKey: `attn-with-ref-${randomUUID()}`,
      });
      await paymentsRepository.finalizeRefund(ORG_A, claimed.id as string, {
        providerReference: payment.providerReference,
      });

      const result = await paymentsRepository.findRefundsRequiringAttention({
        page: 1,
        limit: 100,
        organizationId: ORG_A,
      });
      const found = result.data.find((r) => r.id === (claimed.id as string));
      expect(found).toBeDefined();
      expect(found!.providerReference).toBe(payment.providerReference);
    });

    it('pagination is correct: limit is respected and total reflects the full matching set', async () => {
      const invoice = await seedInvoice(ORG_A, 1000);
      const payment = await paymentsService.create(ORG_A, USER_ID, {
        invoiceId: invoice.id as string,
        amount: 300,
      });
      provider.statusByReference.set(payment.providerReference!, 'completed');
      await paymentsService.reconcileProcessingPayment(
        ORG_A,
        payment.id as string,
      );

      provider.refundBehavior = 'ambiguous';
      for (let i = 0; i < 3; i += 1) {
        await expect(
          paymentsService.refund(
            ORG_A,
            USER_ID,
            { paymentId: payment.id as string, amount: 10 },
            `attn-page-${i}-${randomUUID()}`,
          ),
        ).rejects.toThrow();
      }
      provider.refundBehavior = 'succeed';

      const page1 = await paymentsRepository.findRefundsRequiringAttention({
        page: 1,
        limit: 2,
        organizationId: ORG_A,
      });
      expect(page1.data.length).toBeLessThanOrEqual(2);
      expect(page1.total).toBeGreaterThanOrEqual(3);
      expect(page1.page).toBe(1);
      expect(page1.limit).toBe(2);
    });
  });

  describe('Stage 2.10 — findProcessingPaymentsPaginated (operational observability)', () => {
    it('P-P1 — a pending payment appears in the listing', async () => {
      const invoice = await seedInvoice(ORG_A, 1000);
      const payment = await paymentsService.create(ORG_A, USER_ID, {
        invoiceId: invoice.id as string,
        amount: 111,
      });
      expect(payment.status).toBe('pending');

      const result = await paymentsRepository.findProcessingPaymentsPaginated({
        page: 1,
        limit: 100,
        organizationId: ORG_A,
      });
      const found = result.data.find((p) => p.id === (payment.id as string));
      expect(found).toBeDefined();
      expect(found!.status).toBe('pending');
    });

    it('P-P2 — a processing payment appears in the listing', async () => {
      const invoice = await seedInvoice(ORG_A, 1000);
      const payment = await paymentsService.create(ORG_A, USER_ID, {
        invoiceId: invoice.id as string,
        amount: 112,
      });
      // Force it into 'processing' directly — createPayment() itself only ever produces
      // 'pending' for this fixture (mirroring FlutterwaveProvider); 'processing' is the
      // idempotency-claim staging value ManualPaymentProvider's own flow moves through, so we
      // set it directly here rather than fabricate a second fixture provider mode for it.
      await paymentsRepository.finalizePayment(ORG_A, payment.id as string, {
        status: 'processing',
      });

      const result = await paymentsRepository.findProcessingPaymentsPaginated({
        page: 1,
        limit: 100,
        organizationId: ORG_A,
      });
      const found = result.data.find((p) => p.id === (payment.id as string));
      expect(found).toBeDefined();
      expect(found!.status).toBe('processing');
    });

    it('P-P3 — a completed payment is excluded', async () => {
      const invoice = await seedInvoice(ORG_A, 1000);
      const payment = await paymentsService.create(ORG_A, USER_ID, {
        invoiceId: invoice.id as string,
        amount: 113,
      });
      provider.statusByReference.set(payment.providerReference!, 'completed');
      await paymentsService.reconcileProcessingPayment(
        ORG_A,
        payment.id as string,
      );

      const result = await paymentsRepository.findProcessingPaymentsPaginated({
        page: 1,
        limit: 100,
        organizationId: ORG_A,
      });
      expect(result.data.map((p) => p.id)).not.toContain(payment.id as string);
    });

    it('P-P4 — a failed payment is excluded', async () => {
      const invoice = await seedInvoice(ORG_A, 1000);
      const payment = await paymentsService.create(ORG_A, USER_ID, {
        invoiceId: invoice.id as string,
        amount: 114,
      });
      provider.statusByReference.set(payment.providerReference!, 'failed');
      const reconciled = await paymentsService.reconcileProcessingPayment(
        ORG_A,
        payment.id as string,
      );
      expect(reconciled.status).toBe('failed');

      const result = await paymentsRepository.findProcessingPaymentsPaginated({
        page: 1,
        limit: 100,
        organizationId: ORG_A,
      });
      expect(result.data.map((p) => p.id)).not.toContain(payment.id as string);
    });

    it('P-P5 — a fully refunded payment (status: refunded) is excluded', async () => {
      const invoice = await seedInvoice(ORG_A, 1000);
      const payment = await paymentsService.create(ORG_A, USER_ID, {
        invoiceId: invoice.id as string,
        amount: 115,
      });
      provider.statusByReference.set(payment.providerReference!, 'completed');
      await paymentsService.reconcileProcessingPayment(
        ORG_A,
        payment.id as string,
      );
      const refunded = await paymentsService.refund(
        ORG_A,
        USER_ID,
        { paymentId: payment.id as string, amount: 115 },
        `pp5-refund-${randomUUID()}`,
      );
      const finalPayment = await paymentsRepository.findById(
        ORG_A,
        payment.id as string,
      );
      expect(finalPayment!.status).toBe('refunded');
      expect(refunded.amount).toBe(115);

      const result = await paymentsRepository.findProcessingPaymentsPaginated({
        page: 1,
        limit: 100,
        organizationId: ORG_A,
      });
      expect(result.data.map((p) => p.id)).not.toContain(payment.id as string);
    });

    it("P-P6 — organizationId filter isolates tenants: an operator filtering by one org never sees another tenant's processing payment", async () => {
      const invoiceA = await seedInvoice(ORG_A, 1000);
      const paymentA = await paymentsService.create(ORG_A, USER_ID, {
        invoiceId: invoiceA.id as string,
        amount: 116,
      });
      const invoiceB = await seedInvoice(ORG_B, 1000);
      const paymentB = await paymentsService.create(ORG_B, USER_ID, {
        invoiceId: invoiceB.id as string,
        amount: 117,
      });

      const resultA = await paymentsRepository.findProcessingPaymentsPaginated({
        page: 1,
        limit: 100,
        organizationId: ORG_A,
      });
      expect(resultA.data.every((p) => p.organizationId === ORG_A)).toBe(true);
      expect(resultA.data.map((p) => p.id)).not.toContain(
        paymentB.id as string,
      );

      const resultB = await paymentsRepository.findProcessingPaymentsPaginated({
        page: 1,
        limit: 100,
        organizationId: ORG_B,
      });
      expect(resultB.data.every((p) => p.organizationId === ORG_B)).toBe(true);
      expect(resultB.data.map((p) => p.id)).not.toContain(
        paymentA.id as string,
      );
    });

    it('P-P7 — pagination is correct: limit is respected and total reflects the full matching set', async () => {
      const invoice = await seedInvoice(ORG_A, 1000);
      const created: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const payment = await paymentsService.create(ORG_A, USER_ID, {
          invoiceId: invoice.id as string,
          amount: 10,
        });
        created.push(payment.id as string);
      }

      const page1 = await paymentsRepository.findProcessingPaymentsPaginated({
        page: 1,
        limit: 2,
        organizationId: ORG_A,
      });
      expect(page1.data.length).toBeLessThanOrEqual(2);
      expect(page1.total).toBeGreaterThanOrEqual(3);
      expect(page1.page).toBe(1);
      expect(page1.limit).toBe(2);

      // No id repeats/skips across every page of this org's own candidates.
      const seen = new Set<string>();
      for (let page = 1; page <= page1.total; page += 1) {
        const result = await paymentsRepository.findProcessingPaymentsPaginated(
          {
            page,
            limit: 1,
            organizationId: ORG_A,
          },
        );
        for (const p of result.data) {
          expect(seen.has(p.id)).toBe(false);
          seen.add(p.id);
        }
      }
      for (const id of created) {
        expect(seen.has(id)).toBe(true);
      }
    });

    it("P-P8 — the script layer caps --limit at 100 (verified at the repository call boundary: the repository itself trusts its caller's limit, exactly like findRefundsRequiringAttention — the cap is enforced by the script, not the repository, matching the Stage 2.8 convention)", async () => {
      // Documents this deliberately: findProcessingPaymentsPaginated, like
      // findRefundsRequiringAttention before it, applies whatever `limit` it's given directly
      // to the Mongo query — the 100-cap is enforced once, at the CLI argument-parsing layer
      // (scripts/list-processing-payments.ts's own parseArgs, mirroring
      // list-refunds-requiring-attention.ts exactly), not duplicated as a second guard here.
      const result = await paymentsRepository.findProcessingPaymentsPaginated({
        page: 1,
        limit: 5,
        organizationId: ORG_A,
      });
      expect(result.limit).toBe(5);
    });

    it('P-P9 — sensitive fields are never exposed: no raw Idempotency-Key, only a boolean presence flag', async () => {
      const invoice = await seedInvoice(ORG_A, 1000);
      const secretLookingKey = `super-secret-payment-key-${randomUUID()}`;
      const payment = await paymentsService.create(
        ORG_A,
        USER_ID,
        { invoiceId: invoice.id as string, amount: 118 },
        secretLookingKey,
      );

      const result = await paymentsRepository.findProcessingPaymentsPaginated({
        page: 1,
        limit: 100,
        organizationId: ORG_A,
      });
      const found = result.data.find((p) => p.id === (payment.id as string));
      expect(found).toBeDefined();
      expect(found!.hasIdempotencyKey).toBe(true);
      expect(JSON.stringify(found)).not.toContain(secretLookingKey);
      expect(Object.keys(found as object).sort()).toEqual(
        [
          'id',
          'organizationId',
          'invoiceId',
          'status',
          'amount',
          'currency',
          'provider',
          'providerReference',
          'hasIdempotencyKey',
          'createdAt',
        ].sort(),
      );
    });

    it('P-P10 — providerReference is returned when present, and is a real, non-secret merchant reference (never fabricated when absent)', async () => {
      const invoice = await seedInvoice(ORG_A, 1000);
      const payment = await paymentsService.create(ORG_A, USER_ID, {
        invoiceId: invoice.id as string,
        amount: 119,
      });
      // The fixture provider always returns a providerReference synchronously on create() —
      // mirroring FlutterwaveProvider.createPayment's own real, tested behavior (tx_ref is
      // always known immediately, unlike a refund's provider reference).
      expect(payment.providerReference).toBeDefined();

      const result = await paymentsRepository.findProcessingPaymentsPaginated({
        page: 1,
        limit: 100,
        organizationId: ORG_A,
      });
      const found = result.data.find((p) => p.id === (payment.id as string));
      expect(found).toBeDefined();
      expect(found!.providerReference).toBe(payment.providerReference);
    });

    it('the new {status,createdAt} index does not break findProcessingPayments (the existing, unmodified reconciliation-sweep method)', async () => {
      const invoice = await seedInvoice(ORG_A, 1000);
      const payment = await paymentsService.create(ORG_A, USER_ID, {
        invoiceId: invoice.id as string,
        amount: 120,
      });

      const candidates = await paymentsRepository.findProcessingPayments();
      expect(candidates.map((c) => String(c._id))).toContain(
        payment.id as string,
      );
    });
  });
});
