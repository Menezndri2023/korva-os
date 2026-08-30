import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
import { Invoice, InvoiceDocument } from './schemas/invoice.schema';
import type { Paginated } from '../../crm/contacts/contacts.repository';

export interface FindInvoicesOptions {
  page: number;
  limit: number;
  status?: string;
  contactId?: string;
}

@Injectable()
export class InvoicesRepository {
  constructor(
    @InjectModel(Invoice.name)
    private readonly invoiceModel: Model<InvoiceDocument>,
  ) {}

  /**
   * `session`, when given, must be honored via the array form of `create()` — Mongoose only
   * attaches a session to the write when docs are passed as an array; `create(doc, { session })`
   * silently ignores it (same caveat as PaymentsRepository.createPayment). Passed by
   * OrdersService.generateInvoice so this write commits/aborts together with the
   * Order.invoiceId update in the same MongoDB transaction.
   */
  async create(
    data: Partial<Invoice>,
    session?: ClientSession,
  ): Promise<InvoiceDocument> {
    const [invoice] = await this.invoiceModel.create([data], { session });
    return invoice!;
  }

  findById(
    organizationId: string,
    id: string,
  ): Promise<InvoiceDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.invoiceModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  /** Batched `$in` lookup — used by TimeEntriesService.getCommissionReport to resolve the
   *  payment status of every invoice a batch of time entries was billed through, in one
   *  round trip instead of one findById() per distinct invoice. */
  findByIds(organizationId: string, ids: string[]): Promise<InvoiceDocument[]> {
    const validIds = ids
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (validIds.length === 0) return Promise.resolve([]);
    return this.invoiceModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
        _id: { $in: validIds },
      })
      .exec();
  }

  async findAll(
    organizationId: string,
    options: FindInvoicesOptions,
  ): Promise<Paginated<InvoiceDocument>> {
    const filter: FilterQuery<Invoice> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (options.status) filter.status = options.status;
    if (options.contactId)
      filter.contactId = new Types.ObjectId(options.contactId);

    const skip = (options.page - 1) * options.limit;
    const [data, total] = await Promise.all([
      this.invoiceModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(options.limit)
        .exec(),
      this.invoiceModel.countDocuments(filter).exec(),
    ]);

    return { data, total };
  }

  async update(
    organizationId: string,
    id: string,
    data: Partial<Invoice>,
  ): Promise<InvoiceDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.invoiceModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
        },
        data,
        { new: true },
      )
      .exec();
  }

  /**
   * Atomically applies `delta` to `amountPaid` and recomputes `status` from the
   * post-increment value — both in the same MongoDB pipeline update, so there is no
   * read-calculate-write window for two concurrent payments/refunds to race each other.
   * Mirrors the exact clamp/rounding/status rules `applyPaymentDelta` used to apply in JS:
   * clamp to >=0, round to 2 decimals, status = issued/paid/partially_paid.
   *
   * `session`, when given, ties this atomic update to the caller's MongoDB transaction (see
   * PaymentsService.refund) — the $max clamp and status pipeline are unchanged; only the
   * commit/abort boundary moves to the caller.
   */
  async incrementAmountPaid(
    organizationId: string,
    id: string,
    delta: number,
    session?: ClientSession,
  ): Promise<InvoiceDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.invoiceModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
        },
        [
          {
            $set: {
              amountPaid: {
                $max: [0, { $round: [{ $add: ['$amountPaid', delta] }, 2] }],
              },
            },
          },
          {
            $set: {
              status: {
                $switch: {
                  branches: [
                    { case: { $lte: ['$amountPaid', 0] }, then: 'issued' },
                    { case: { $gte: ['$amountPaid', '$total'] }, then: 'paid' },
                  ],
                  default: 'partially_paid',
                },
              },
            },
          },
        ],
        { new: true, session },
      )
      .exec();
  }

  /**
   * Payment-specific variant of incrementAmountPaid: the accept/reject decision for
   * "does amountPaid + delta stay within total" is made by MongoDB itself, as part of the
   * SAME atomic findOneAndUpdate, via $expr in the match filter — not by a value read
   * earlier. Two concurrent calls that would together exceed `total` can therefore never
   * both match: only one findAndModify wins the document at a time, and by the time the
   * second one evaluates its filter, amountPaid already reflects the first one's write.
   * Resolves to null if the filter didn't match — either the invoice doesn't exist, or
   * (the case this method exists for) applying `delta` would exceed `total`; the caller,
   * which is expected to have already confirmed the invoice exists, treats null as the
   * latter. Left as a separate method rather than folded into incrementAmountPaid so that
   * unbounded callers (refunds) are entirely unaffected by this guard.
   *
   * `session`, when given, ties this atomic update to the caller's MongoDB transaction (see
   * PaymentsService.create) — the $expr balance guard still runs, unchanged, as part of the
   * same findOneAndUpdate; only the commit/abort boundary moves to the caller.
   */
  async incrementAmountPaidWithinLimit(
    organizationId: string,
    id: string,
    delta: number,
    session?: ClientSession,
  ): Promise<InvoiceDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.invoiceModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
          $expr: {
            $lte: [{ $round: [{ $add: ['$amountPaid', delta] }, 2] }, '$total'],
          },
        },
        [
          {
            $set: {
              amountPaid: {
                $max: [0, { $round: [{ $add: ['$amountPaid', delta] }, 2] }],
              },
            },
          },
          {
            $set: {
              status: {
                $switch: {
                  branches: [
                    { case: { $lte: ['$amountPaid', 0] }, then: 'issued' },
                    { case: { $gte: ['$amountPaid', '$total'] }, then: 'paid' },
                  ],
                  default: 'partially_paid',
                },
              },
            },
          },
        ],
        { new: true, session },
      )
      .exec();
  }

  /**
   * Candidate list for InvoiceOverdueSchedulerService — mirrors QuotesRepository.findExpirable /
   * PaymentsRepository.findProcessingPayments (a global, org-agnostic query; the sweep is
   * system-wide, not per-tenant). An invoice is overdue once `dueDate` has passed and it still
   * carries an outstanding balance — 'issued' or 'partially_paid'; 'draft'/'paid'/'cancelled'/
   * already-'overdue' are excluded.
   */
  findOverdueCandidates(limit = 100): Promise<InvoiceDocument[]> {
    return this.invoiceModel
      .find({
        status: { $in: ['issued', 'partially_paid'] },
        dueDate: { $lt: new Date() },
      })
      .limit(limit)
      .exec();
  }

  /**
   * Atomically transitions a single invoice to 'overdue', guarded by the SAME eligibility
   * filter used by findOverdueCandidates — so an invoice paid/cancelled concurrently between the
   * sweep's read and this write is left untouched, and re-running this on an already-overdue
   * invoice is a no-op (returns null).
   */
  markOverdueIfEligible(
    organizationId: string,
    id: string,
  ): Promise<InvoiceDocument | null> {
    return this.invoiceModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
          status: { $in: ['issued', 'partially_paid'] },
          dueDate: { $lt: new Date() },
        },
        { status: 'overdue' },
        { new: true },
      )
      .exec();
  }
}
