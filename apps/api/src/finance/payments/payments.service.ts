import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
  Optional,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection, Types } from 'mongoose';
import { minimumOnlinePayment, type PaymentStatus } from '@korva/types';
import type { CreatePaymentInput, CreateRefundInput } from '@korva/validation';
import { PaymentsRepository } from './payments.repository';
import { Payment, PaymentDocument } from './schemas/payment.schema';
import { Refund, RefundDocument } from './schemas/refund.schema';
import { WalletService } from '../wallet/wallet.service';
import { InvoicesService } from '../invoices/invoices.service';
import { MembershipsService } from '../../identity/memberships/memberships.service';
import { AuditService } from '../../audit/audit.service';
import { EventBusService } from '../../core/events/event-bus.service';
import { PaymentProviderResolverService } from './providers/payment-provider-resolver.service';
import {
  PAYMENT_PROVIDER,
  isAmbiguousProviderError,
  getAmbiguousErrorProviderReference,
  type PaymentProvider,
  type PaymentProviderResult,
} from './providers/payment-provider.interface';

type RefundStatus = 'processing' | 'completed' | 'failed';

/**
 * Thrown internally when a guarded finalize (see PaymentsRepository.finalizePayment's
 * `requireStatus`) finds the claim already moved past 'processing' — i.e. a concurrent
 * reconciliation run (or, in principle, the original request) got there first. Caught by
 * PaymentReconciliationService's callers to treat that as a benign "nothing left to do", never
 * surfaced as an HTTP error. The original create()/refund() call sites never trigger this in
 * practice — the claim insert already gave them exclusive ownership — but if they somehow did,
 * it still propagates as a normal Error, matching their existing catch-and-mark-failed handling.
 */
export class IdempotencyClaimNoLongerProcessingError extends Error {
  constructor(entityId: string) {
    super(`Claim ${entityId} is no longer 'processing'`);
    this.name = 'IdempotencyClaimNoLongerProcessingError';
  }
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly paymentsRepository: PaymentsRepository,
    private readonly invoicesService: InvoicesService,
    private readonly membershipsService: MembershipsService,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBusService,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
    private readonly paymentProviderResolver: PaymentProviderResolverService,
    @InjectConnection() private readonly connection: Connection,
    // Le Solde KORVA: an online payment KORVA received is credited to the business. Optional so
    // unit tests that build this service by hand keep working; the reconciliation sweep credits
    // anything missed here anyway.
    @Optional() private readonly walletService?: WalletService,
  ) {}

  /** Best-effort: the payment is already recorded; the sweep retries a credit that failed. */
  private async creditWallet(
    organizationId: string,
    paymentId: string,
  ): Promise<void> {
    try {
      await this.walletService?.creditFromPayment(organizationId, paymentId);
    } catch (error) {
      this.logger.error(
        `Wallet credit failed for payment ${paymentId} — the sweep will retry`,
        error,
      );
    }
  }

  /**
   * Resolves the PaymentProvider that must be used for an EXISTING payment/refund — always the
   * one actually recorded on the row (`recordedProviderName`), never "whatever's currently
   * configured for this organization's market" (an organization can reconfigure/replace its
   * connected PSP at any time; a payment created under the old one must still be queried/
   * refunded through that same one forever, or its `providerReference` means nothing to
   * whichever gateway gets called). Returns the injected ManualPaymentProvider directly when it
   * matches — the common case for every staff-recorded payment/refund, and the only case that
   * existed before online payments did. For anything else, resolves through
   * PaymentProviderResolverService and throws `PAYMENT_PROVIDER_MISMATCH` if the organization's
   * currently configured provider for that market no longer matches what the row was created
   * with, rather than silently querying/refunding through the wrong gateway — callers that
   * already treat "provider query failed" as a benign, retry-later outcome (reconciliation)
   * handle this identically; callers on the staff-facing HTTP path (refund()) surface it as a
   * clear 422.
   */
  private async resolveProviderForExisting(
    organizationId: string,
    recordedProviderName: string,
  ): Promise<PaymentProvider> {
    if (recordedProviderName === this.paymentProvider.name) {
      return this.paymentProvider;
    }
    const resolved = await this.paymentProviderResolver.resolve({
      flow: 'commerce',
      organizationId,
    });
    if (resolved.name !== recordedProviderName) {
      throw new UnprocessableEntityException({
        code: 'PAYMENT_PROVIDER_MISMATCH',
        message: `This payment was created via "${recordedProviderName}", but the organization's currently configured provider is "${resolved.name}" — it cannot be safely queried or refunded through a different gateway.`,
      });
    }
    return resolved;
  }

  /** Thin pass-through to the repository — kept on the service so callers outside FinanceModule
   *  (e.g. ReturnRequestsService) never need PaymentsRepository exported directly, matching this
   *  codebase's convention that a module's Service, not its Repository, is the module boundary. */
  findCompletedPaymentForInvoice(
    organizationId: string,
    invoiceId: string,
  ): Promise<PaymentDocument | null> {
    return this.paymentsRepository.findCompletedByInvoiceId(
      organizationId,
      invoiceId,
    );
  }

  /**
   * `idempotencyKey`, when given (from the `Idempotency-Key` HTTP header — see
   * PaymentsController.create), guarantees that retrying this exact call never calls the
   * payment provider twice, never creates a second Payment, and never re-credits the Invoice.
   * Absent entirely, behavior is byte-for-byte the pre-idempotency legacy flow (existing
   * callers that don't send the header are unaffected).
   *
   * The idempotency check runs FIRST, before any invoice/balance validation — a resolved retry
   * must return its original outcome unconditionally, even if the invoice's balance or status
   * has since changed (e.g. the original payment itself was what brought the balance to zero;
   * checking balance again on the retry would wrongly reject an already-successful replay).
   *
   * `userId` is undefined for a customer-initiated online payment (the storefront checkout has
   * no staff member to attribute the audit-log entry to — see AuditService's own optional
   * `userId`); `online`, when given, is used instead of the injected ManualPaymentProvider — the
   * storefront checkout flow resolves a real PSP via PaymentProviderResolverService and passes
   * it (plus the payer's email and where their browser should return to) here, so the exact
   * same idempotency/atomicity machinery below is never duplicated for the online-payment path.
   */
  async create(
    organizationId: string,
    userId: string | undefined,
    input: CreatePaymentInput,
    idempotencyKey?: string,
    online?: {
      provider: PaymentProvider;
      /** Absent for a counter sale: nobody typed an e-mail (GeniusPay doesn't need one). */
      customerEmail?: string;
      redirectUrl: string;
    },
  ): Promise<PaymentDocument> {
    const provider = online?.provider ?? this.paymentProvider;
    if (idempotencyKey) {
      const existing = await this.paymentsRepository.findByIdempotencyKey(
        organizationId,
        idempotencyKey,
      );
      if (existing) {
        this.assertSameLogicalRequest(existing, input);
        // Whatever its current status — 'processing' (a concurrent or crashed attempt hasn't
        // resolved yet), 'completed', or 'failed' — this is the one and only outcome this key
        // will ever have. No provider call, no new Payment, no Invoice write.
        return existing;
      }
    }

    const invoice = await this.invoicesService.getById(
      organizationId,
      input.invoiceId,
    );
    if (invoice.status === 'draft' || invoice.status === 'cancelled') {
      throw new BadRequestException({
        code: 'INVOICE_NOT_PAYABLE',
        message: `Cannot record a payment against an invoice with status "${invoice.status}"`,
      });
    }

    // Fast, non-atomic pre-check against the snapshot we already have — rejects an obviously
    // invalid amount early, with a precise "remaining balance" figure, before ever calling
    // the payment provider. This is a courtesy fast-fail, NOT the concurrency boundary: two
    // simultaneous requests can both pass this check using the same stale amountPaid. The
    // atomic guard below (applied at the moment the invoice is actually updated) is what
    // actually enforces amountPaid + amount <= total under concurrency.
    const remaining =
      Math.round((invoice.total - invoice.amountPaid) * 100) / 100;
    if (input.amount > remaining) {
      throw new BadRequestException({
        code: 'PAYMENT_EXCEEDS_BALANCE',
        message: `Payment amount (${input.amount}) exceeds the remaining balance (${remaining})`,
      });
    }
    // Online only: below KORVA's floor GeniusPay's fixed fee would take more than a fifth of the
    // sale (MIN_ONLINE_PAYMENT, validated 2026-11-07). Cash and staff-recorded payments have none.
    if (online) {
      const minimum = minimumOnlinePayment(invoice.currency);
      if (input.amount < minimum) {
        throw new BadRequestException({
          code: 'ONLINE_PAYMENT_BELOW_MINIMUM',
          message: `Online payment starts at ${minimum} ${invoice.currency}`,
          minimum,
        });
      }
    }
    // Deliberately NOT checked against `remaining`/amountPaid — a tip is extra money the
    // customer chose to give, not part of what's owed on the invoice (see the schema's own doc).
    if (input.tipStaffMembershipId) {
      const membership = await this.membershipsService.findByIdForOrganization(
        input.tipStaffMembershipId,
        organizationId,
      );
      if (!membership) {
        throw new NotFoundException({
          code: 'MEMBERSHIP_NOT_FOUND',
          message: 'Membership not found',
        });
      }
    }

    // Claims the idempotency key BEFORE calling the provider — the atomic unique index on
    // (organizationId, idempotencyKey) is what actually arbitrates two concurrent requests for
    // the same key: only one insert can win, and only the winner may call the provider. A
    // losing insert (E11000) means someone else claimed it a moment ago; re-read and behave
    // exactly like the pre-check above (same params → return it, different → reject) instead
    // of proceeding — this is the mechanism, not a courtesy check, since the unique index
    // itself is what MongoDB enforces atomically.
    let claimedPaymentId: string | undefined;
    if (idempotencyKey) {
      try {
        const claimed = await this.paymentsRepository.createPayment({
          organizationId: new Types.ObjectId(organizationId),
          invoiceId: new Types.ObjectId(input.invoiceId),
          amount: input.amount,
          currency: invoice.currency,
          status: 'processing',
          provider: provider.name,
          method: input.method,
          ...recordedBy(userId),
          idempotencyKey,
        });
        claimedPaymentId = claimed.id as string;
      } catch (error) {
        if (!isDuplicateIdempotencyKeyError(error)) throw error;
        const existing = await this.paymentsRepository.findByIdempotencyKey(
          organizationId,
          idempotencyKey,
        );
        if (!existing) {
          throw new BadRequestException({
            code: 'IDEMPOTENCY_KEY_CONFLICT',
            message: 'Idempotency key is already in use',
          });
        }
        this.assertSameLogicalRequest(existing, input);
        return existing;
      }
    }

    // The provider call stays outside any MongoDB transaction — Mongo has no way to roll back
    // an external HTTP call, so by the time we reach the block below, "completed" is already a
    // fact we're recording, not something a later abort could undo (see §3/§9 of the audit).
    let result: PaymentProviderResult;
    try {
      result = await provider.createPayment({
        amount: input.amount,
        currency: invoice.currency,
        invoiceId: input.invoiceId,
        ...(online
          ? {
              customerEmail: online.customerEmail,
              redirectUrl: online.redirectUrl,
            }
          : {}),
      });
    } catch (error) {
      // Stage 2.6 — an AMBIGUOUS provider error (network timeout: no HTTP response was ever
      // received, so the provider may have genuinely created the payment) must NOT be collapsed
      // into 'failed' the way a definite rejection is. Marking it 'failed' here would let a
      // caller legitimately retry with a brand-new Idempotency-Key — which, if the provider
      // actually did process the original request, risks the customer completing a REAL
      // checkout KORVA has no record of. Leaving the claim in 'processing' keeps it visible
      // (queryable) instead of silently marked resolved; it does NOT by itself make this
      // specific claim auto-reconcilable, since no providerReference was ever captured for it
      // (see the final report's residual-gap note on this).
      if (isAmbiguousProviderError(error)) {
        // Stage 2.12 — a provider adapter (e.g. FlutterwaveProvider.createPayment) may have
        // already generated and sent a merchant reference (tx_ref) to the provider BEFORE this
        // ambiguous failure occurred. Previously that reference was always discarded here along
        // with the rest of the error. This is pure evidence capture, reusing the exact same
        // best-effort persistProviderReference() helper the definite-success path already uses
        // below — it is a no-op when claimedPaymentId is undefined (no Idempotency-Key was
        // given), and it never changes the Payment's status, which stays 'processing' exactly as
        // it already did before this stage. See getAmbiguousErrorProviderReference's own doc
        // comment for why this is never treated as evidence the provider actually did anything.
        await this.persistProviderReference(
          organizationId,
          claimedPaymentId,
          getAmbiguousErrorProviderReference(error),
        );
        throw error;
      }
      // The claim must not be left stuck in 'processing' forever on a DEFINITE provider
      // rejection — a retry with the same key needs a resolved (if failed) outcome to compare
      // against, never an indefinitely-open claim. A NEW attempt requires a NEW
      // Idempotency-Key — deliberately simple, matching how idempotency keys are normally
      // scoped to one permanent outcome (see §H Scenario 2 of the audit).
      await this.markIdempotencyClaimFailed(organizationId, claimedPaymentId);
      throw error;
    }

    // Persisted the instant we have it, BEFORE attempting the transactional finalize below —
    // if the process crashes between here and that transaction committing, this is what lets
    // PaymentReconciliationService later ask the provider what really happened instead of
    // leaving the claim stuck in 'processing' with nothing to query. Best-effort: the
    // transaction below sets the same value moments later regardless, so a failure here must
    // never abort the operation itself.
    await this.persistProviderReference(
      organizationId,
      claimedPaymentId,
      result.providerReference,
    );

    const paymentData: Partial<Payment> = {
      organizationId: new Types.ObjectId(organizationId),
      invoiceId: new Types.ObjectId(input.invoiceId),
      amount: input.amount,
      currency: invoice.currency,
      status: result.status,
      provider: provider.name,
      providerReference: result.providerReference,
      checkoutUrl: result.checkoutUrl,
      method: input.method,
      ...recordedBy(userId),
      tipAmount: input.tipAmount,
      tipStaffMembershipId: input.tipStaffMembershipId
        ? new Types.ObjectId(input.tipStaffMembershipId)
        : undefined,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    };

    // Invoice.amountPaid and the Payment document are two MongoDB writes recording the same
    // business fact ("this payment was accepted") — only wrapped in a transaction when there
    // are actually two writes to keep atomic. A non-completed result (pending/failed) never
    // touches the invoice, so it's a single plain write, same as before.
    let payment: PaymentDocument;
    try {
      payment =
        result.status === 'completed'
          ? await this.createCompletedPaymentAtomically(
              organizationId,
              input.invoiceId,
              input.amount,
              paymentData,
              claimedPaymentId,
            )
          : claimedPaymentId
            ? await this.finalizeClaimedPayment(
                organizationId,
                claimedPaymentId,
                paymentData,
              )
            : await this.paymentsRepository.createPayment(paymentData);
    } catch (error) {
      await this.markIdempotencyClaimFailed(organizationId, claimedPaymentId);
      throw error;
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'PAYMENT',
      entity: 'payment',
      entityId: payment.id as string,
      metadata: {
        invoiceId: input.invoiceId,
        amount: input.amount,
        status: result.status,
      },
    });

    if (result.status === 'completed') {
      await this.eventBus.publish(organizationId, 'payment.completed', {
        paymentId: payment.id as string,
        invoiceId: input.invoiceId,
        amount: input.amount,
      });
      await this.creditWallet(organizationId, payment.id as string);
    }

    return payment;
  }

  /**
   * A retry sharing an Idempotency-Key must carry the exact same logical request — otherwise
   * the key is being reused for something else entirely, which is a client bug, not a replay.
   */
  private assertSameLogicalRequest(
    existing: PaymentDocument,
    input: CreatePaymentInput,
  ): void {
    const sameRequest =
      existing.invoiceId.toString() === input.invoiceId &&
      existing.amount === input.amount &&
      (existing.method ?? null) === (input.method ?? null) &&
      (existing.tipAmount ?? null) === (input.tipAmount ?? null);
    if (!sameRequest) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_MISMATCH',
        message:
          'This Idempotency-Key was already used with different payment parameters',
      });
    }
  }

  /**
   * Best-effort — the original error is what must surface to the caller either way. A plain
   * `.catch()` chained onto the call would miss a SYNCHRONOUS throw from finalizePayment (it
   * only intercepts a rejected Promise, not an exception thrown before one is even returned),
   * so this needs a real try/catch.
   */
  private async markIdempotencyClaimFailed(
    organizationId: string,
    claimedPaymentId: string | undefined,
  ): Promise<void> {
    if (!claimedPaymentId) return;
    try {
      await this.paymentsRepository.finalizePayment(
        organizationId,
        claimedPaymentId,
        { status: 'failed' },
      );
    } catch {
      // best-effort
    }
  }

  /**
   * Best-effort — see the call site in create() for why a failure here must never abort the
   * operation, and markIdempotencyClaimFailed above for why this needs try/catch rather than
   * `.catch()`.
   */
  private async persistProviderReference(
    organizationId: string,
    claimedPaymentId: string | undefined,
    providerReference: string | undefined,
  ): Promise<void> {
    if (!claimedPaymentId || !providerReference) return;
    try {
      await this.paymentsRepository.finalizePayment(
        organizationId,
        claimedPaymentId,
        { providerReference },
      );
    } catch {
      // best-effort
    }
  }

  /**
   * `requireStatus`, when given, is forwarded to the repository's guarded update — see
   * PaymentsRepository.finalizePayment for why. When it rejects (claim no longer 'processing'),
   * that's a normal, expected outcome for a reconciliation caller (not "vanished") — signaled
   * via IdempotencyClaimNoLongerProcessingError instead of the generic "should never happen"
   * Error the original create() flow still gets when no requireStatus is given.
   */
  private async finalizeClaimedPayment(
    organizationId: string,
    claimedPaymentId: string,
    paymentData: Partial<Payment>,
    session?: ClientSession,
    requireStatus?: PaymentStatus,
  ): Promise<PaymentDocument> {
    const finalized = await this.paymentsRepository.finalizePayment(
      organizationId,
      claimedPaymentId,
      paymentData,
      session,
      requireStatus,
    );
    if (!finalized) {
      if (requireStatus) {
        throw new IdempotencyClaimNoLongerProcessingError(claimedPaymentId);
      }
      throw new Error(
        `Idempotency claim ${claimedPaymentId} vanished before it could be finalized`,
      );
    }
    return finalized;
  }

  /**
   * Applies the balance-checked Invoice.amountPaid increment and creates (or, for an
   * idempotency-claimed attempt, finalizes) the Payment document in a single MongoDB
   * transaction: either both writes commit, or neither does. Without this, a crash between the
   * two leaves either an Invoice credited with no matching Payment, or a Payment recorded
   * against an invoice that was never actually credited — the exact gap this step exists to
   * close (see the multi-document integrity audit).
   *
   * PAYMENT_EXCEEDS_BALANCE stays enforced by incrementAmountPaidWithinLimit's atomic $expr
   * guard, unchanged — it just now runs as part of this transaction instead of a bare write. If
   * the guard rejects it, throwing here aborts the transaction: the invoice update never
   * commits and no Payment is created/finalized (the caller's catch block marks the
   * idempotency claim, if any, 'failed' outside this transaction).
   *
   * The Payment finalize runs BEFORE the Invoice credit (not after, as it did before
   * reconciliation existed) specifically so `requireStatus` — passed by
   * PaymentReconciliationService, always undefined for create()'s own call — can abort the
   * whole transaction, Invoice included, the instant it detects a concurrent reconciliation
   * already claimed this Payment. For create()'s own call site this reorder changes nothing
   * observable: the claim is always still 'processing' at this point (nothing else could have
   * touched it), and the transaction is all-or-nothing either way.
   */
  private async createCompletedPaymentAtomically(
    organizationId: string,
    invoiceId: string,
    amount: number,
    paymentData: Partial<Payment>,
    claimedPaymentId?: string,
    requireStatus?: PaymentStatus,
  ): Promise<PaymentDocument> {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const finalizedPayment = claimedPaymentId
          ? await this.finalizeClaimedPayment(
              organizationId,
              claimedPaymentId,
              paymentData,
              session,
              requireStatus,
            )
          : undefined;

        const updatedInvoice =
          await this.invoicesService.applyPaymentIfWithinBalance(
            organizationId,
            invoiceId,
            amount,
            session,
          );
        if (!updatedInvoice) {
          throw new BadRequestException({
            code: 'PAYMENT_EXCEEDS_BALANCE',
            message: 'Payment amount exceeds the remaining balance',
          });
        }

        return (
          finalizedPayment ??
          (await this.paymentsRepository.createPayment(paymentData, session))
        );
      });
    } finally {
      await session.endSession();
    }
  }

  list(organizationId: string, invoiceId?: string): Promise<PaymentDocument[]> {
    return this.paymentsRepository.findAll(organizationId, invoiceId);
  }

  /**
   * Reconciliation entry point for a single Payment not yet finalized by its provider — called
   * by PaymentReconciliationService, and (Stage 2.6) by FlutterwaveWebhookController right after
   * a verified webhook delivery, as a latency optimization layered on top of the periodic sweep
   * (never a replacement for it — see ReconciliationSchedulerService). Queries the provider's
   * current authoritative status via providerReference and synchronizes Mongo accordingly,
   * reusing the exact same atomic guard/transaction as create() (createCompletedPaymentAtomically)
   * — never a second financial write path. Idempotent and concurrency-safe: running this twice,
   * or concurrently from two workers (or a worker and a webhook delivery), applies the Invoice
   * credit at most once — the guarded finalize inside the transaction is what MongoDB itself
   * arbitrates that on, keyed on whichever not-yet-final status the Payment is ACTUALLY in right
   * now (see `requireStatus: payment.status` below), never a status this method assumes.
   *
   * Stage 2.6 — accepts BOTH 'pending' and 'processing' as "not yet resolved" (previously only
   * 'processing'), matching findProcessingPayments' own broadened candidate query: a
   * FlutterwaveProvider-created Payment is always 'pending' immediately after createPayment()
   * (real completion is asynchronous), and a Payment stuck at 'pending' was, before this fix,
   * structurally unreachable by this method — this NotFoundException-adjacent early return would
   * never even attempt the provider query.
   */
  /** The one payment a given idempotency key ever produced, if any — e.g. a storefront order's
   *  online payment, keyed `public-order-payment:<orderId>`. */
  findByIdempotencyKey(
    organizationId: string,
    idempotencyKey: string,
  ): Promise<PaymentDocument | null> {
    return this.paymentsRepository.findByIdempotencyKey(
      organizationId,
      idempotencyKey,
    );
  }

  async reconcileProcessingPayment(
    organizationId: string,
    paymentId: string,
  ): Promise<PaymentDocument> {
    const payment = await this.paymentsRepository.findById(
      organizationId,
      paymentId,
    );
    if (!payment) {
      throw new NotFoundException({
        code: 'PAYMENT_NOT_FOUND',
        message: 'Payment not found',
      });
    }
    const notYetResolvedStatus: PaymentStatus[] = ['pending', 'processing'];
    if (
      !notYetResolvedStatus.includes(payment.status) ||
      !payment.providerReference
    ) {
      // Already resolved (by the original request, or a prior/concurrent reconciliation run),
      // or never actually confirmed to have reached the provider at all — nothing to query,
      // nothing to do. See the final report for why the latter case (no providerReference) is
      // the one gap this mechanism cannot close on its own.
      return payment;
    }
    // The atomic guard below must match whichever of the two not-yet-resolved statuses this
    // Payment is ACTUALLY in right now — never a hardcoded literal — so a Payment that's
    // 'pending' gets guarded on 'pending' and one that's 'processing' gets guarded on
    // 'processing'; either way, a concurrent caller racing on the exact same document can still
    // only win the atomic finalize once.
    const currentStatus = payment.status;

    let providerStatus: PaymentStatus;
    try {
      const provider = await this.resolveProviderForExisting(
        organizationId,
        payment.provider,
      );
      providerStatus = await provider.getPaymentStatus(
        payment.providerReference,
      );
    } catch (error) {
      this.logger.error(
        `Reconciliation: provider query failed for Payment ${paymentId}`,
        error,
      );
      return payment; // leave as-is — a later run may find the provider reachable again
    }

    if (providerStatus === 'completed') {
      try {
        const finalizedPayment = await this.createCompletedPaymentAtomically(
          organizationId,
          payment.invoiceId.toString(),
          payment.amount,
          {
            status: 'completed',
            providerReference: payment.providerReference,
          },
          paymentId,
          currentStatus,
        );
        // Stage 2.6's original gap: reconciliation finalized the Payment/Invoice writes but
        // never published payment.completed, so the Workflow/Decision Engine — and, as of the
        // booking-payment-status sync, OrdersService.syncBookingPaymentStatusFromInvoice too —
        // were blind to any payment confirmed asynchronously (webhook or periodic sweep) rather
        // than synchronously inside create(). Mirrors create()'s own publish call exactly.
        await this.eventBus.publish(organizationId, 'payment.completed', {
          paymentId: finalizedPayment.id as string,
          invoiceId: payment.invoiceId.toString(),
          amount: payment.amount,
        });
        await this.creditWallet(organizationId, finalizedPayment.id as string);
        return finalizedPayment;
      } catch (error) {
        if (error instanceof IdempotencyClaimNoLongerProcessingError) {
          return (await this.paymentsRepository.findById(
            organizationId,
            paymentId,
          ))!;
        }
        // The provider has already confirmed this payment completed — a Mongo-side error
        // while recording that fact must never be misread as a provider failure. Leave the
        // Payment as-is (never mark it 'failed' here) so the next reconciliation run can
        // safely retry finalizing it.
        this.logger.error(
          `Reconciliation: failed to finalize completed Payment ${paymentId}`,
          error,
        );
        return payment;
      }
    }

    if (providerStatus === 'failed') {
      try {
        const finalized = await this.paymentsRepository.finalizePayment(
          organizationId,
          paymentId,
          { status: 'failed' },
          undefined,
          currentStatus,
        );
        return (
          finalized ??
          (await this.paymentsRepository.findById(organizationId, paymentId))!
        );
      } catch (error) {
        this.logger.error(
          `Reconciliation: failed to mark failed Payment ${paymentId}`,
          error,
        );
        return payment;
      }
    }

    // pending/processing/refunded from the provider's point of view — not yet resolved; leave
    // as-is and let a future reconciliation run try again.
    return payment;
  }

  /**
   * `idempotencyKey`, from the `Idempotency-Key` HTTP header (see PaymentsController.refund) —
   * Stage 2.7B: **mandatory**, unlike PaymentsService.create()'s own optional one. A refund's
   * provider call is the genuinely dangerous ambiguous-timeout case (a retry that the provider
   * actually processed the first time would move real money a second time — see Stage 2.6/2.7A's
   * own audits); requiring a key here is what makes retrying with the SAME key (safe: returns
   * the existing claim, never calls the provider again) the only sane way to retry at all.
   * `POST /payments` intentionally stays optional in this stage — see the Stage 2.7B final report
   * for why (an existing internal caller, `apps/web`, does not send this header today; no known
   * caller of this refund endpoint exists to break).
   *
   * Checked FIRST, before any DB read — an absent/empty key must never create a Refund claim or
   * reach the provider at all (see REFUND_IDEMPOTENCY_KEY_REQUIRED's own call site).
   *
   * The idempotency check runs immediately after, before any payment/balance validation — for
   * the exact same reason as create(): a fully-successful refund flips Payment.status from
   * 'completed' to 'refunded' (see incrementRefundedAmountWithinLimit), so checking
   * `payment.status !== 'completed'` again on a retry would wrongly reject an already-successful
   * replay of that same full refund.
   */
  async refund(
    organizationId: string,
    userId: string,
    input: CreateRefundInput,
    idempotencyKey?: string,
  ): Promise<RefundDocument> {
    if (!idempotencyKey) {
      throw new BadRequestException({
        code: 'REFUND_IDEMPOTENCY_KEY_REQUIRED',
        message:
          'An Idempotency-Key header is required to request a refund — this prevents a retry after an ambiguous provider timeout from ever refunding twice',
      });
    }

    const existingByKey =
      await this.paymentsRepository.findRefundByIdempotencyKey(
        organizationId,
        idempotencyKey,
      );
    if (existingByKey) {
      this.assertSameLogicalRefundRequest(existingByKey, input);
      // Whatever its current status — 'processing', 'completed', or 'failed' — this is the
      // one and only outcome this key will ever have. No provider call, no new Refund, no
      // Payment/Invoice write.
      return existingByKey;
    }

    const payment = await this.paymentsRepository.findById(
      organizationId,
      input.paymentId,
    );
    if (!payment) {
      throw new NotFoundException({
        code: 'PAYMENT_NOT_FOUND',
        message: 'Payment not found',
      });
    }
    if (payment.status !== 'completed') {
      throw new BadRequestException({
        code: 'PAYMENT_NOT_REFUNDABLE',
        message: `Cannot refund a payment with status "${payment.status}"`,
      });
    }

    // Fast, non-atomic pre-check — same two-tier pattern as PaymentsService.create(): a
    // courtesy fast-fail with a precise "refundable balance" figure, NOT the concurrency
    // boundary. Two simultaneous refunds can both pass this using the same stale
    // alreadyRefunded snapshot; incrementRefundedAmountWithinLimit below (inside the
    // transaction) is what actually enforces refundedAmount + amount <= payment.amount.
    const alreadyRefunded = await this.paymentsRepository.sumRefundsForPayment(
      organizationId,
      input.paymentId,
    );
    const refundable =
      Math.round((payment.amount - alreadyRefunded) * 100) / 100;
    if (input.amount > refundable) {
      throw new BadRequestException({
        code: 'REFUND_EXCEEDS_PAYMENT',
        message: `Refund amount (${input.amount}) exceeds the refundable balance (${refundable})`,
      });
    }

    // Claims the idempotency key BEFORE calling the provider — the atomic unique index on
    // (organizationId, idempotencyKey) on Refund arbitrates two concurrent requests for the
    // same key, not a courtesy check. Stage 2.7B: this claim is now unconditional (the key is
    // guaranteed present by the guard above) — `claimedRefundId` is therefore always set past
    // this point, which is what makes the ambiguous-provider-error handling below and the
    // localReferenceForReconciliation breadcrumb always available for a refund, not merely
    // best-effort the way create()'s own (still-optional) key remains.
    let claimedRefundId: string;
    try {
      const claimed = await this.paymentsRepository.createRefund({
        organizationId: new Types.ObjectId(organizationId),
        paymentId: new Types.ObjectId(input.paymentId),
        amount: input.amount,
        reason: input.reason,
        status: 'processing',
        idempotencyKey,
      });
      claimedRefundId = claimed.id as string;
    } catch (error) {
      if (!isDuplicateIdempotencyKeyError(error)) throw error;
      const existing = await this.paymentsRepository.findRefundByIdempotencyKey(
        organizationId,
        idempotencyKey,
      );
      if (!existing) {
        throw new BadRequestException({
          code: 'IDEMPOTENCY_KEY_CONFLICT',
          message: 'Idempotency key is already in use',
        });
      }
      this.assertSameLogicalRefundRequest(existing, input);
      return existing;
    }

    // The provider call stays outside any MongoDB transaction — same reasoning as
    // PaymentsService.create(): Mongo can't roll back an external HTTP call, so by the time we
    // reach the block below the refund is already a fact we're recording.
    //
    // Stage 2.7A — `claimedRefundId` (only set when an Idempotency-Key was given, i.e. a local
    // Refund claim already exists) is forwarded as the adapter's optional
    // `localReferenceForReconciliation` breadcrumb — see PaymentProvider.refundPayment's own doc
    // comment for exactly what this does and does not (yet) enable. Never sent when no claim
    // exists (nothing to reference).
    let refundResult: PaymentProviderResult;
    try {
      const provider = await this.resolveProviderForExisting(
        organizationId,
        payment.provider,
      );
      refundResult = await provider.refundPayment(
        payment.providerReference ?? (payment.id as string),
        input.amount,
        claimedRefundId,
      );
    } catch (error) {
      // Stage 2.6 — see create()'s identical guard for the full reasoning: an AMBIGUOUS
      // provider error here is the genuinely dangerous case (§9/§13 of the audit — "double
      // refund possible"), since a caller who sees this refund marked 'failed' may retry with a
      // brand-new Idempotency-Key, which — if Flutterwave actually processed the original
      // refund despite the timeout — would refund the customer a SECOND time for real money.
      // Leaving the claim 'processing' instead at least makes the ambiguity visible/queryable.
      // RESIDUAL GAP (documented, not silently fixed): no refund-specific providerReference was
      // ever captured for this attempt (persistRefundProviderReference only runs after a
      // successful provider response), so reconcileProcessingRefund's own
      // `!refund.providerReference` guard means this specific claim cannot yet be
      // auto-reconciled by the periodic sweep — see the final report's BUSINESS DECISION
      // REQUIRED section.
      if (isAmbiguousProviderError(error)) {
        throw error;
      }
      // The claim must not be left stuck in 'processing' forever on a DEFINITE provider
      // rejection — see markIdempotencyClaimFailed in create() for the identical reasoning. A
      // genuinely new attempt requires a new Idempotency-Key.
      await this.markRefundIdempotencyClaimFailed(
        organizationId,
        claimedRefundId,
      );
      throw error;
    }

    // Persisted the instant we have it, BEFORE the transactional finalize below — previously
    // this reference was discarded entirely, which meant a Refund stuck in 'processing' could
    // never be reconciled at all (nothing to query the provider with). Best-effort, mirroring
    // persistProviderReference in create().
    await this.persistRefundProviderReference(
      organizationId,
      claimedRefundId,
      refundResult.providerReference,
      refundResult.providerRefundId,
      refundResult.providerRefundReference,
    );

    let refund: RefundDocument;
    try {
      refund = await this.refundAtomically(
        organizationId,
        payment,
        input,
        claimedRefundId,
      );
    } catch (error) {
      await this.markRefundIdempotencyClaimFailed(
        organizationId,
        claimedRefundId,
      );
      throw error;
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'REFUND',
      entity: 'payment',
      entityId: input.paymentId,
      metadata: { amount: input.amount, reason: input.reason },
    });

    return refund;
  }

  /**
   * A retry sharing an Idempotency-Key must carry the exact same logical refund request —
   * otherwise the key is being reused for something else entirely, which is a client bug, not
   * a replay. Mirrors assertSameLogicalRequest in create().
   */
  private assertSameLogicalRefundRequest(
    existing: RefundDocument,
    input: CreateRefundInput,
  ): void {
    const sameRequest =
      existing.paymentId.toString() === input.paymentId &&
      existing.amount === input.amount &&
      (existing.reason ?? null) === (input.reason ?? null);
    if (!sameRequest) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_MISMATCH',
        message:
          'This Idempotency-Key was already used with different refund parameters',
      });
    }
  }

  /**
   * Best-effort — see markIdempotencyClaimFailed above for why this needs try/catch rather
   * than a chained `.catch()`.
   */
  private async markRefundIdempotencyClaimFailed(
    organizationId: string,
    claimedRefundId: string | undefined,
  ): Promise<void> {
    if (!claimedRefundId) return;
    try {
      await this.paymentsRepository.finalizeRefund(
        organizationId,
        claimedRefundId,
        { status: 'failed' },
      );
    } catch {
      // best-effort
    }
  }

  /**
   * Best-effort — see the call site in refund() for why a failure here must never abort the
   * operation. `providerRefundId`/`providerRefundReference` (Stage 2.12) are genuinely
   * refund-specific identifiers Flutterwave's refund-creation response may contain, kept
   * distinct from `providerReference` (which is always the underlying Payment's own tx_ref) —
   * see Refund schema's own doc comments on these two fields. Both are optional and only ever
   * included in the update when the caller actually has a value for them (FlutterwaveProvider's
   * refundPayment already only sets them on PaymentProviderResult when the response contains
   * them — nothing here fabricates a value that wasn't already there).
   */
  private async persistRefundProviderReference(
    organizationId: string,
    claimedRefundId: string | undefined,
    providerReference: string | undefined,
    providerRefundId?: string,
    providerRefundReference?: string,
  ): Promise<void> {
    if (!claimedRefundId || !providerReference) return;
    try {
      await this.paymentsRepository.finalizeRefund(
        organizationId,
        claimedRefundId,
        {
          providerReference,
          ...(providerRefundId ? { providerRefundId } : {}),
          ...(providerRefundReference ? { providerRefundReference } : {}),
        },
      );
    } catch {
      // best-effort
    }
  }

  /** `requireStatus` mirrors finalizeClaimedPayment's — see there for the full reasoning. */
  private async finalizeClaimedRefund(
    organizationId: string,
    claimedRefundId: string,
    refundData: Partial<Refund>,
    session?: ClientSession,
    requireStatus?: RefundStatus,
  ): Promise<RefundDocument> {
    const finalized = await this.paymentsRepository.finalizeRefund(
      organizationId,
      claimedRefundId,
      refundData,
      session,
      requireStatus,
    );
    if (!finalized) {
      if (requireStatus) {
        throw new IdempotencyClaimNoLongerProcessingError(claimedRefundId);
      }
      throw new Error(
        `Idempotency claim ${claimedRefundId} vanished before it could be finalized`,
      );
    }
    return finalized;
  }

  /**
   * Payment.refundedAmount increment (with its atomic REFUND_EXCEEDS_PAYMENT guard) +
   * Refund.create() (or, for an idempotency-claimed attempt, finalize) + Invoice.amountPaid
   * decrement, all in one MongoDB transaction: either all three writes commit, or none do.
   * Mirrors createCompletedPaymentAtomically in the payment flow. Without this, a crash between
   * the writes could leave a Refund recorded with no matching Payment/Invoice adjustment, or a
   * Payment/Invoice adjusted with no Refund on file.
   *
   * The Refund finalize runs BEFORE the Payment.refundedAmount increment (not after, as it did
   * before reconciliation existed) for the exact same reason createCompletedPaymentAtomically
   * reorders its own two writes — see there. `incrementRefundedAmountWithinLimit`'s own $expr
   * guard prevents exceeding `amount`, but does NOT by itself prevent the SAME logical refund
   * being applied twice by two concurrent reconciliation runs; the guarded Refund finalize is
   * what does that.
   */
  private async refundAtomically(
    organizationId: string,
    payment: PaymentDocument,
    input: CreateRefundInput,
    claimedRefundId?: string,
    requireStatus?: RefundStatus,
  ): Promise<RefundDocument> {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const refundData: Partial<Refund> = {
          organizationId: new Types.ObjectId(organizationId),
          paymentId: new Types.ObjectId(input.paymentId),
          amount: input.amount,
          reason: input.reason,
          ...(claimedRefundId ? { status: 'completed' as const } : {}),
        };

        const createdRefund = claimedRefundId
          ? await this.finalizeClaimedRefund(
              organizationId,
              claimedRefundId,
              refundData,
              session,
              requireStatus,
            )
          : await this.paymentsRepository.createRefund(refundData, session);

        const updatedPayment =
          await this.paymentsRepository.incrementRefundedAmountWithinLimit(
            organizationId,
            input.paymentId,
            input.amount,
            session,
          );
        if (!updatedPayment) {
          throw new BadRequestException({
            code: 'REFUND_EXCEEDS_PAYMENT',
            message: 'Refund amount exceeds the refundable balance',
          });
        }

        await this.invoicesService.applyPaymentDelta(
          organizationId,
          payment.invoiceId.toString(),
          -input.amount,
          session,
        );

        return createdRefund;
      });
    } finally {
      await session.endSession();
    }
  }

  /**
   * Reconciliation entry point for a single Refund stuck in 'processing' — mirrors
   * reconcileProcessingPayment exactly; see there for the full reasoning. Reuses
   * refundAtomically, never a second refund transaction implementation.
   */
  async reconcileProcessingRefund(
    organizationId: string,
    refundId: string,
  ): Promise<RefundDocument> {
    const refund = await this.paymentsRepository.findRefundById(
      organizationId,
      refundId,
    );
    if (!refund) {
      throw new NotFoundException({
        code: 'REFUND_NOT_FOUND',
        message: 'Refund not found',
      });
    }
    if (refund.status !== 'processing' || !refund.providerReference) {
      return refund;
    }

    // Refund itself carries no provider name of its own (see schema) — always resolved via the
    // Payment it refunds, exactly like refund() above.
    const payment = await this.paymentsRepository.findById(
      organizationId,
      refund.paymentId.toString(),
    );
    if (!payment) {
      this.logger.error(
        `Reconciliation: Payment ${refund.paymentId.toString()} for Refund ${refundId} no longer exists`,
      );
      return refund;
    }

    let providerStatus: PaymentStatus;
    try {
      const provider = await this.resolveProviderForExisting(
        organizationId,
        payment.provider,
      );
      providerStatus = await provider.getPaymentStatus(
        refund.providerReference,
      );
    } catch (error) {
      this.logger.error(
        `Reconciliation: provider query failed for Refund ${refundId}`,
        error,
      );
      return refund;
    }

    // ManualPaymentProvider's own refundPayment() reports success as status 'refunded' (not
    // 'completed') — a getPaymentStatus query is expected to be able to answer either way
    // depending on provider convention, so both are treated as "the refund succeeded" here.
    if (providerStatus === 'completed' || providerStatus === 'refunded') {
      const payment = await this.paymentsRepository.findById(
        organizationId,
        refund.paymentId.toString(),
      );
      if (!payment) {
        throw new NotFoundException({
          code: 'PAYMENT_NOT_FOUND',
          message: 'Payment not found',
        });
      }
      try {
        return await this.refundAtomically(
          organizationId,
          payment,
          {
            paymentId: refund.paymentId.toString(),
            amount: refund.amount,
            reason: refund.reason,
          },
          refundId,
          'processing',
        );
      } catch (error) {
        if (error instanceof IdempotencyClaimNoLongerProcessingError) {
          return (await this.paymentsRepository.findRefundById(
            organizationId,
            refundId,
          ))!;
        }
        // The provider has already confirmed this refund succeeded — a Mongo-side error while
        // recording that fact must never be misread as a provider failure. Leave the Refund
        // 'processing' so the next reconciliation run can safely retry finalizing it.
        this.logger.error(
          `Reconciliation: failed to finalize completed Refund ${refundId}`,
          error,
        );
        return refund;
      }
    }

    if (providerStatus === 'failed') {
      try {
        const finalized = await this.paymentsRepository.finalizeRefund(
          organizationId,
          refundId,
          { status: 'failed' },
          undefined,
          'processing',
        );
        return (
          finalized ??
          (await this.paymentsRepository.findRefundById(
            organizationId,
            refundId,
          ))!
        );
      } catch (error) {
        this.logger.error(
          `Reconciliation: failed to mark failed Refund ${refundId}`,
          error,
        );
        return refund;
      }
    }

    return refund;
  }
}

/**
 * True for the MongoDB duplicate-key error (code 11000) raised by the partial unique index on
 * (organizationId, idempotencyKey) — on either Payment or Refund, both indexed on a field of
 * the same name, so this one check covers both claim sites (create() and refund()). Narrowed
 * by index field name in the driver's error message, mirroring isDuplicateOrderIdError in
 * OrdersService, so an unrelated unique-index collision isn't silently swallowed as an
 * idempotency race.
 */
function isDuplicateIdempotencyKeyError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as Record<string, unknown>;
  return (
    code === 11000 &&
    typeof message === 'string' &&
    message.includes('idempotencyKey')
  );
}

/** Who took the payment, for the till report — absent for a customer's own online payment. */
function recordedBy(userId: string | undefined): Partial<Payment> {
  return userId && Types.ObjectId.isValid(userId)
    ? { recordedBy: new Types.ObjectId(userId) }
    : {};
}
