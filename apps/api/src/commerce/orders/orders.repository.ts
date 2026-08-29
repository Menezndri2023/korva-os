import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
import { Order, OrderDocument } from './schemas/order.schema';
import type { Paginated } from '../../crm/contacts/contacts.repository';

export interface FindOrdersOptions {
  page: number;
  limit: number;
  status?: string;
  contactId?: string;
}

@Injectable()
export class OrdersRepository {
  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
  ) {}

  /**
   * `session`, when given, must be honored via the array form of `create()` — Mongoose only
   * attaches a session to the write when docs are passed as an array; `create(doc, { session })`
   * silently ignores it (same caveat as InvoicesRepository.create / PaymentsRepository). Passed
   * by OrdersService.createFromCart so this write commits/aborts together with the Cart status
   * update in the same MongoDB transaction.
   */
  async create(
    data: Partial<Order>,
    session?: ClientSession,
  ): Promise<OrderDocument> {
    const [order] = await this.orderModel.create([data], { session });
    return order!;
  }

  findById(organizationId: string, id: string): Promise<OrderDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.orderModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  findByBookingId(
    organizationId: string,
    bookingId: string,
  ): Promise<OrderDocument | null> {
    return this.orderModel
      .findOne({
        organizationId: new Types.ObjectId(organizationId),
        bookingId: new Types.ObjectId(bookingId),
      })
      .exec();
  }

  /** Used by BookingPaymentSyncService to trace a paid Invoice back to the booking it was generated for. */
  findByInvoiceId(
    organizationId: string,
    invoiceId: string,
  ): Promise<OrderDocument | null> {
    if (!Types.ObjectId.isValid(invoiceId)) return Promise.resolve(null);
    return this.orderModel
      .findOne({
        organizationId: new Types.ObjectId(organizationId),
        invoiceId: new Types.ObjectId(invoiceId),
      })
      .exec();
  }

  async findAll(
    organizationId: string,
    options: FindOrdersOptions,
  ): Promise<Paginated<OrderDocument>> {
    const filter: FilterQuery<Order> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (options.status) filter.status = options.status;
    if (options.contactId)
      filter.contactId = new Types.ObjectId(options.contactId);

    const skip = (options.page - 1) * options.limit;
    const [data, total] = await Promise.all([
      this.orderModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(options.limit)
        .exec(),
      this.orderModel.countDocuments(filter).exec(),
    ]);

    return { data, total };
  }

  async update(
    organizationId: string,
    id: string,
    data: Partial<Order>,
  ): Promise<OrderDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.orderModel
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
   * Atomic guard against concurrent generateInvoice() calls: the accept/reject decision ("is
   * this order still uninvoiced") is made by MongoDB itself, in the SAME findOneAndUpdate as
   * the write, via `invoiceId: { $exists: false }` in the filter — not from the `order`
   * snapshot OrdersService.generateInvoice read moments earlier. Two concurrent calls for the
   * same order can therefore never both match: only one findAndModify wins the document at a
   * time. Resolves to null if the filter didn't match — either the order doesn't exist, or (the
   * case this method exists for) it was already invoiced; the caller, which is expected to have
   * already confirmed the order exists, treats null as the latter (ORDER_ALREADY_INVOICED).
   *
   * On its own this already closes the concurrency window: called from inside a MongoDB
   * transaction that also creates the Invoice (see OrdersService.generateInvoice), a losing
   * concurrent attempt hits a write conflict on this same Order document, its whole transaction
   * — including the Invoice it just inserted — gets aborted and retried, and the retry's filter
   * then correctly sees the winner's committed invoiceId and no longer matches. The partial
   * unique index on Invoice.orderId (see the schema) is defense-in-depth on top of this, not a
   * substitute for it.
   */
  async attachInvoiceIfUnset(
    organizationId: string,
    id: string,
    invoiceId: string,
    session?: ClientSession,
  ): Promise<OrderDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.orderModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
          invoiceId: { $exists: false },
        },
        { invoiceId: new Types.ObjectId(invoiceId) },
        { new: true, session },
      )
      .exec();
  }
}
