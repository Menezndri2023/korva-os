import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import type { PaymentStatus } from '@korva/types';
import { Payment, PaymentDocument } from './schemas/payment.schema';
import { Refund, RefundDocument } from './schemas/refund.schema';

type RefundStatus = 'processing' | 'completed' | 'failed';

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
   * Candidate list for PaymentReconciliationService — every Payment currently stuck in
   * 'processing', regardless of organization (a background sweep, not a per-tenant read; each
   * result carries its own organizationId for the caller to scope subsequent calls with).
   * `limit` keeps a single sweep bounded; callers needing more page via repeated calls.
   */
  findProcessingPayments(limit = 100): Promise<PaymentDocument[]> {
    return this.paymentModel.find({ status: 'processing' }).limit(limit).exec();
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

  /** Candidate list for PaymentReconciliationService — mirrors findProcessingPayments. */
  findProcessingRefunds(limit = 100): Promise<RefundDocument[]> {
    return this.refundModel.find({ status: 'processing' }).limit(limit).exec();
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
