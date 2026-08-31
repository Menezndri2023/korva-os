import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import type { PaymentStatus } from '@korva/types';
import { Payment, PaymentDocument } from './schemas/payment.schema';
import { Refund, RefundDocument } from './schemas/refund.schema';

type RefundStatus = 'processing' | 'completed' | 'failed';

/**
 * Stage 2.10 — deliberately secret-free (see findProcessingPaymentsPaginated's own doc comment
 * for exactly what's excluded and why). Unlike RefundRequiringAttentionSummary below, this
 * carries no `note`/distress-implying field: a `pending`/`processing` Payment is the ordinary,
 * expected in-flight state for an asynchronous provider (Flutterwave) — the periodic
 * reconciliation sweep resolves the overwhelming majority of these automatically within one
 * interval (see PaymentReconciliationService) — so labelling every row here as "needing
 * attention" the way a stuck Refund genuinely does would be misleading.
 */
export interface ProcessingPaymentSummary {
  id: string;
  organizationId: string;
  invoiceId: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  provider: string;
  providerReference: string | undefined;
  hasIdempotencyKey: boolean;
  createdAt: Date;
}

/**
 * Stage 2.8 — deliberately secret-free (see findRefundsRequiringAttention's own doc comment for
 * exactly what's excluded and why). `note` is a fixed, static disclaimer string — never derived
 * from any provider response — that exists specifically so this summary can never be
 * misinterpreted as "provider confirmed failed/succeeded" by whoever reads it.
 */
export interface RefundRequiringAttentionSummary {
  id: string;
  paymentId: string;
  organizationId: string;
  amount: number;
  currency: string | undefined;
  reason: string | undefined;
  provider: string | undefined;
  providerReference: string | undefined;
  hasIdempotencyKey: boolean;
  createdAt: Date;
  note: string;
}

@Injectable()
export class PaymentsRepository {
  constructor(
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    @InjectModel(Refund.name)
    private readonly refundModel: Model<RefundDocument>,
  ) {}

  /**
   * `session`, when given, must be honored via the array form of `create()` — Mongoose only
   * attaches a session to the write when docs are passed as an array; `create(doc, { session })`
   * silently ignores it. Passed by PaymentsService when this write must commit/abort together
   * with the Invoice.amountPaid update in the same MongoDB transaction.
   */
  async createPayment(
    data: Partial<Payment>,
    session?: ClientSession,
  ): Promise<PaymentDocument> {
    const [payment] = await this.paymentModel.create([data], { session });
    return payment!;
  }

  findById(
    organizationId: string,
    id: string,
  ): Promise<PaymentDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.paymentModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  /** The most recent completed payment against an invoice — used by ReturnRequestsService to
   *  find something refundable for an order without the caller needing to already know a
   *  paymentId (an order only exposes its invoiceId, never a paymentId directly). An invoice
   *  paid in several partial installments has several completed Payments; picking the most
   *  recent one is a deliberate v1 simplification (mirrors this codebase's other documented
   *  "pick one, don't try to be clever" choices, e.g. the single-platform-wide Paystack secret) —
   *  revisit only if partial/split payments across multiple providers becomes a real scenario. */
  findCompletedByInvoiceId(
    organizationId: string,
    invoiceId: string,
  ): Promise<PaymentDocument | null> {
    return this.paymentModel
      .findOne({
        organizationId: new Types.ObjectId(organizationId),
        invoiceId: new Types.ObjectId(invoiceId),
        status: 'completed',
      })
      .sort({ createdAt: -1 })
      .exec();
  }

  /** Scoped by organizationId — an Idempotency-Key only has meaning within the org that issued it. */
  findByIdempotencyKey(
    organizationId: string,
    idempotencyKey: string,
  ): Promise<PaymentDocument | null> {
    return this.paymentModel
      .findOne({
        organizationId: new Types.ObjectId(organizationId),
        idempotencyKey,
      })
      .exec();
  }

  /**
   * Resolves a Payment previously claimed via createPayment(..., { status: 'processing',
   * idempotencyKey }) to its final state (status/providerReference/...) once the provider has
   * responded — an update-in-place, not a second insert, so the same _id (and therefore the
   * same idempotency claim) carries through from reservation to resolution. `session`, when
   * given, ties this to the caller's MongoDB transaction (see
   * PaymentsService.createCompletedPaymentAtomically), exactly like createPayment's session
   * parameter.
   *
   * `requireStatus`, when given, adds that status to the filter — the same findOneAndUpdate
   * then only matches (and only writes) if the document is still in that status. The original
   * create()/refund() call sites never need this: the claim insert already gave them exclusive
   * ownership, so the row can only be in 'processing' when they call this. It exists for
   * PaymentReconciliationService, which can race against another concurrent reconciliation run
   * for the same Payment — this is what makes the two mutually exclusive at the MongoDB level,
   * not an application-side check.
   */
  async finalizePayment(
    organizationId: string,
    id: string,
    data: Partial<Payment>,
    session?: ClientSession,
    requireStatus?: PaymentStatus,
  ): Promise<PaymentDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.paymentModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
          ...(requireStatus ? { status: requireStatus } : {}),
        },
        data,
        { new: true, session },
      )
      .exec();
  }

  /**
   * Candidate list for PaymentReconciliationService — every Payment not yet finalized by its
   * provider, regardless of organization (a background sweep, not a per-tenant read; each result
   * carries its own organizationId for the caller to scope subsequent calls with). `limit` keeps
   * a single sweep bounded; callers needing more page via repeated calls.
   *
   * Stage 2.6 — includes BOTH 'processing' and 'pending', not just 'processing'. 'processing' is
   * the transient idempotency-claim staging value ManualPaymentProvider's synchronous-completion
   * flow moves through instantly (never observed by a sweep in practice); 'pending' is what a
   * genuinely asynchronous provider like FlutterwaveProvider.createPayment() ALWAYS returns
   * (Flutterwave's own doc: "a successful response here only means a checkout link was created —
   * status is always 'pending', never 'completed'" — completion only happens later, via a real
   * customer checkout). Before this fix, a Flutterwave-created Payment landed in Mongo with
   * status:'pending' and this query only ever selected status:'processing' — meaning a real
   * Flutterwave payment could NEVER be picked up by reconciliation and would stay unresolved
   * forever, even after the customer actually paid. See PaymentsService.reconcileProcessingPayment
   * for the matching guard/requireStatus generalization this depends on.
   */
  findProcessingPayments(limit = 100): Promise<PaymentDocument[]> {
    return this.paymentModel
      .find({ status: { $in: ['pending', 'processing'] } })
      .limit(limit)
      .exec();
  }

  /**
   * Stage 2.10 — operational observability, paginated: a SEPARATE method from
   * findProcessingPayments above (never modified — PaymentReconciliationService's own contract
   * with it is preserved exactly), covering the identical `{status: {$in:['pending',
   * 'processing']}}` candidate set but adding pagination, deterministic sort-by-recency, an
   * optional organizationId filter for an operator investigating one tenant, and a
   * deliberately secret-free projection. Backed by the new `{status:1, createdAt:-1}` index
   * (see PaymentSchema's own comment on it) — never an unbounded scan. `hasIdempotencyKey` is a
   * boolean presence flag only — the raw key is NEVER exposed, mirroring
   * findRefundsRequiringAttention's own identical rule (Stage 2.8). No provider/network call is
   * ever made here — this only reads what KORVA already persisted.
   */
  async findProcessingPaymentsPaginated(input: {
    page: number;
    limit: number;
    organizationId?: string;
  }): Promise<{
    data: ProcessingPaymentSummary[];
    total: number;
    page: number;
    limit: number;
  }> {
    const filter: Record<string, unknown> = {
      status: { $in: ['pending', 'processing'] },
    };
    if (input.organizationId) {
      filter.organizationId = new Types.ObjectId(input.organizationId);
    }

    const [docs, total] = await Promise.all([
      this.paymentModel
        .find(filter)
        .select(
          'organizationId invoiceId status amount currency provider providerReference idempotencyKey createdAt',
        )
        .sort({ createdAt: -1 })
        .skip((input.page - 1) * input.limit)
        .limit(input.limit)
        .exec(),
      this.paymentModel.countDocuments(filter).exec(),
    ]);

    return {
      data: docs.map((doc) => ({
        id: String(doc._id),
        organizationId: String(doc.organizationId),
        invoiceId: String(doc.invoiceId),
        status: doc.status,
        amount: doc.amount,
        currency: doc.currency,
        provider: doc.provider,
        providerReference: doc.providerReference,
        hasIdempotencyKey: Boolean(doc.idempotencyKey),
        createdAt: (doc as unknown as { createdAt: Date }).createdAt,
      })),
      total,
      page: input.page,
      limit: input.limit,
    };
  }

  findAll(
    organizationId: string,
    invoiceId?: string,
  ): Promise<PaymentDocument[]> {
    const filter: Record<string, unknown> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (invoiceId) filter.invoiceId = new Types.ObjectId(invoiceId);
    return this.paymentModel.find(filter).sort({ createdAt: -1 }).exec();
  }

  /**
   * Atomic guard against concurrent refunds exceeding what's actually left to refund on this
   * Payment: the accept/reject decision ("does refundedAmount + delta stay within amount") is
   * made by MongoDB itself, in the SAME findOneAndUpdate as the write, via $expr — not from a
   * value read moments earlier by the caller's non-atomic sumRefundsForPayment() pre-check
   * (see PaymentsService.refund). Two concurrent refunds that would together exceed `amount`
   * can therefore never both match, mirroring incrementAmountPaidWithinLimit on Invoice.
   *
   * `$ifNull` on `refundedAmount` makes this correct for Payment documents created before this
   * field existed — Mongoose schema defaults only apply to newly constructed documents, never
   * retroactively to documents already in the collection, so no backfill migration is needed.
   *
   * Status is recomputed in the same write: once refundedAmount reaches `amount`, status
   * becomes 'refunded' (the pre-existing business rule — a payment is never
   * "partially_refunded", only 'completed' while a partial refund balance remains, 'refunded'
   * once fully refunded); otherwise the existing status is left untouched. This replaces the
   * separate updatePaymentStatus('refunded') call — the status transition is now part of the
   * same atomic write instead of a second, unguarded one.
   *
   * Resolves to null if the filter didn't match — either the payment doesn't exist, or
   * (the case this method exists for) applying `delta` would exceed `amount`; the caller,
   * which is expected to have already confirmed the payment exists, treats null as the latter.
   */
  async incrementRefundedAmountWithinLimit(
    organizationId: string,
    id: string,
    delta: number,
    session?: ClientSession,
  ): Promise<PaymentDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.paymentModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
          $expr: {
            $lte: [
              {
                $round: [
                  { $add: [{ $ifNull: ['$refundedAmount', 0] }, delta] },
                  2,
                ],
              },
              '$amount',
            ],
          },
        },
        [
          {
            $set: {
              refundedAmount: {
                $round: [
                  { $add: [{ $ifNull: ['$refundedAmount', 0] }, delta] },
                  2,
                ],
              },
            },
          },
          {
            $set: {
              status: {
                $cond: [
                  { $gte: ['$refundedAmount', '$amount'] },
                  'refunded',
                  '$status',
                ],
              },
            },
          },
        ],
        { new: true, session },
      )
      .exec();
  }

  /**
   * `session`, when given, must be honored via the array form of `create()` — same Mongoose
   * caveat as PaymentsRepository.createPayment. Passed by PaymentsService.refund so this write
   * commits/aborts together with the Payment.refundedAmount increment and the
   * Invoice.amountPaid decrement in the same MongoDB transaction.
   */
  async createRefund(
    data: Partial<Refund>,
    session?: ClientSession,
  ): Promise<RefundDocument> {
    const [refund] = await this.refundModel.create([data], { session });
    return refund!;
  }

  findRefundById(
    organizationId: string,
    id: string,
  ): Promise<RefundDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.refundModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  /** Scoped by organizationId — an Idempotency-Key only has meaning within the org that issued it. */
  findRefundByIdempotencyKey(
    organizationId: string,
    idempotencyKey: string,
  ): Promise<RefundDocument | null> {
    return this.refundModel
      .findOne({
        organizationId: new Types.ObjectId(organizationId),
        idempotencyKey,
      })
      .exec();
  }

  /**
   * Resolves a Refund previously claimed via createRefund(..., { status: 'processing',
   * idempotencyKey }) to its final state — an update-in-place, not a second insert, mirroring
   * PaymentsRepository.finalizePayment. `requireStatus` mirrors finalizePayment's — see there
   * for why PaymentReconciliationService needs it and the original refund() flow doesn't.
   */
  async finalizeRefund(
    organizationId: string,
    id: string,
    data: Partial<Refund>,
    session?: ClientSession,
    requireStatus?: RefundStatus,
  ): Promise<RefundDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.refundModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
          ...(requireStatus ? { status: requireStatus } : {}),
        },
        data,
        { new: true, session },
      )
      .exec();
  }

  /**
   * Stage 2.5 — cross-tenant BY NECESSITY, unlike every other method on this repository: this is
   * how a verified Flutterwave webhook (which arrives with no tenant/JWT context at all — see
   * flutterwave-webhook.controller.ts) derives which organization a payment belongs to, by
   * looking up the very Payment record KORVA itself created (with this exact provider +
   * providerReference) when the checkout was first initiated (PaymentsService.create →
   * `this.paymentProvider.createPayment` → `result.providerReference` persisted — for Flutterwave
   * that's always the merchant-generated `tx_ref`, never Flutterwave's own numeric id, per
   * flutterwave-payment.provider.ts's own doc comment). This is a tenant-*discovery* lookup for a
   * caller that doesn't have an organizationId yet, not a tenant-scoped read — so it deliberately
   * projects (`.select`) ONLY `organizationId`, never any other Payment field, to a caller that
   * has no tenant context. Returns `null` if no such Payment exists (unresolved tenant — fails
   * closed, never invents or guesses an organization).
   */
  async findOrganizationIdByProviderReference(
    provider: string,
    providerReference: string,
  ): Promise<string | null> {
    const payment = await this.paymentModel
      .findOne({ provider, providerReference })
      .select('organizationId')
      .exec();
    return payment ? String(payment.organizationId) : null;
  }

  /**
   * Stage 2.6 — a separate, narrowly-scoped lookup from findOrganizationIdByProviderReference
   * above (deliberately NOT modified — Stage 2.5's webhook tenant attribution stays exactly as
   * implemented): this one additionally returns the Payment's own id, for
   * FlutterwaveWebhookController to trigger an immediate PaymentsService.reconcileProcessingPayment
   * call right after a verified webhook delivery, instead of waiting for the next periodic sweep.
   * Still projects only `_id`/`organizationId` — never any other Payment field — to a caller that
   * has no tenant context yet. Returns `null` if no such Payment exists (e.g. the webhook arrived
   * before checkout creation finished persisting the Payment) — the caller is expected to treat
   * that as "nothing to reconcile yet, the periodic sweep will catch it once it exists."
   */
  async findIdByProviderReference(
    provider: string,
    providerReference: string,
  ): Promise<{ id: string; organizationId: string } | null> {
    const payment = await this.paymentModel
      .findOne({ provider, providerReference })
      .select('organizationId')
      .exec();
    return payment
      ? {
          id: String(payment._id),
          organizationId: String(payment.organizationId),
        }
      : null;
  }

  /** Candidate list for PaymentReconciliationService — mirrors findProcessingPayments. */
  findProcessingRefunds(limit = 100): Promise<RefundDocument[]> {
    return this.refundModel.find({ status: 'processing' }).limit(limit).exec();
  }

  /**
   * Stage 2.8 — operational observability, paginated (see findRefundsRequiringAttention below):
   * one page of the exact same `status:'processing'` candidate set findProcessingRefunds already
   * defines, deliberately secret-free. `hasIdempotencyKey` is a boolean presence flag — the raw
   * key is NEVER exposed here (it's a caller-chosen string, not necessarily safe to echo back
   * verbatim in an ops tool). `providerReference` IS exposed in full: it's the underlying
   * Payment's own KORVA-generated merchant reference (`tx_ref`), not a credential — an operator
   * genuinely needs it to look this refund up directly in the Flutterwave dashboard. `provider`
   * and `currency` don't exist on Refund itself (see that schema) — populated from the parent
   * Payment (a plain Mongoose `.populate()`, a read-only join, never a second financial query).
   */
  async findRefundsRequiringAttention(input: {
    page: number;
    limit: number;
    organizationId?: string;
  }): Promise<{
    data: RefundRequiringAttentionSummary[];
    total: number;
    page: number;
    limit: number;
  }> {
    const filter: Record<string, unknown> = { status: 'processing' };
    if (input.organizationId) {
      filter.organizationId = new Types.ObjectId(input.organizationId);
    }

    const [docs, total] = await Promise.all([
      this.refundModel
        .find(filter)
        .select(
          'paymentId organizationId amount reason providerReference idempotencyKey createdAt',
        )
        .populate<{
          paymentId: {
            _id: Types.ObjectId;
            provider?: string;
            currency?: string;
          };
        }>('paymentId', 'provider currency')
        .sort({ createdAt: -1 })
        .skip((input.page - 1) * input.limit)
        .limit(input.limit)
        .exec(),
      this.refundModel.countDocuments(filter).exec(),
    ]);

    return {
      data: docs.map((doc) => {
        const populatedPayment = doc.paymentId as unknown as
          | { _id: Types.ObjectId; provider?: string; currency?: string }
          | Types.ObjectId;
        const paymentId =
          populatedPayment instanceof Types.ObjectId
            ? populatedPayment
            : populatedPayment._id;
        const provider =
          populatedPayment instanceof Types.ObjectId
            ? undefined
            : populatedPayment.provider;
        const currency =
          populatedPayment instanceof Types.ObjectId
            ? undefined
            : populatedPayment.currency;

        return {
          id: String(doc._id),
          paymentId: String(paymentId),
          organizationId: String(doc.organizationId),
          amount: doc.amount,
          currency,
          reason: doc.reason,
          provider,
          providerReference: doc.providerReference,
          hasIdempotencyKey: Boolean(doc.idempotencyKey),
          createdAt: (doc as unknown as { createdAt: Date }).createdAt,
          note: 'processing means the local outcome is unresolved — this does NOT imply the provider succeeded or failed; investigate manually before taking any financial action',
        };
      }),
      total,
      page: input.page,
      limit: input.limit,
    };
  }

  /**
   * Excludes 'processing'/'failed' idempotency claim rows (see Refund.status) — only a legacy
   * Refund (no status field, always meant success) or an explicitly 'completed' one represents
   * a real, confirmed refund. `$nin` naturally matches documents where the field is absent, so
   * this stays correct for every Refund created before the idempotency feature existed. This
   * remains a non-atomic courtesy pre-check, not the concurrency boundary — see
   * PaymentsService.refund and incrementRefundedAmountWithinLimit.
   */
  sumRefundsForPayment(
    organizationId: string,
    paymentId: string,
  ): Promise<number> {
    return this.refundModel
      .aggregate<{ total: number }>([
        {
          $match: {
            organizationId: new Types.ObjectId(organizationId),
            paymentId: new Types.ObjectId(paymentId),
            status: { $nin: ['processing', 'failed'] },
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ])
      .exec()
      .then((rows) => rows[0]?.total ?? 0);
  }
}
