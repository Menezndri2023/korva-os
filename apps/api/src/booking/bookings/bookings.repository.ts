import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
import { Booking, BookingDocument } from './schemas/booking.schema';
import type { Paginated } from '../../crm/contacts/contacts.repository';

const ACTIVE_STATUSES = ['pending', 'confirmed'];

export interface FindBookingsOptions {
  page: number;
  limit: number;
  resourceId?: string;
  status?: string;
  contactId?: string;
  from?: string;
  to?: string;
}

/**
 * "Still occupies the resource after `instant`": a booking holds its resource until blockedUntil
 * (end + the offer's buffer) when it has one, and until endAt otherwise — bookings made before
 * buffers existed have no blockedUntil.
 */
function occupiedAfter(instant: Date): FilterQuery<Booking> {
  return {
    $or: [
      { blockedUntil: { $gt: instant } },
      { blockedUntil: { $exists: false }, endAt: { $gt: instant } },
    ],
  };
}

@Injectable()
export class BookingsRepository {
  constructor(
    @InjectModel(Booking.name)
    private readonly bookingModel: Model<BookingDocument>,
  ) {}

  /**
   * `session`, when given, must be honored via the array form of `create()` — Mongoose only
   * attaches a session to the write when docs are passed as an array; `create(doc, { session })`
   * silently ignores it. Matches Finance's PaymentsRepository.createPayment.
   */
  async create(
    data: Partial<Booking>,
    session?: ClientSession,
  ): Promise<BookingDocument> {
    const [booking] = await this.bookingModel.create([data], { session });
    return booking!;
  }

  findById(
    organizationId: string,
    id: string,
  ): Promise<BookingDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.bookingModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  async findAll(
    organizationId: string,
    options: FindBookingsOptions,
  ): Promise<Paginated<BookingDocument>> {
    const filter: FilterQuery<Booking> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (options.resourceId)
      filter.resourceId = new Types.ObjectId(options.resourceId);
    if (options.status) filter.status = options.status;
    if (options.contactId)
      filter.contactId = new Types.ObjectId(options.contactId);
    if (options.from || options.to) {
      const startAtRange: { $gte?: Date; $lte?: Date } = {};
      if (options.from) startAtRange.$gte = new Date(options.from);
      if (options.to) startAtRange.$lte = new Date(options.to);
      filter.startAt = startAtRange;
    }

    const skip = (options.page - 1) * options.limit;
    const [data, total] = await Promise.all([
      this.bookingModel
        .find(filter)
        .sort({ startAt: 1 })
        .skip(skip)
        .limit(options.limit)
        .exec(),
      this.bookingModel.countDocuments(filter).exec(),
    ]);

    return { data, total };
  }

  /** Active (pending/confirmed) bookings for a resource overlapping [startAt, endAt). */
  findOverlapping(
    organizationId: string,
    resourceId: string,
    startAt: Date,
    endAt: Date,
    excludeBookingId?: string,
    session?: ClientSession,
  ): Promise<BookingDocument[]> {
    const filter: FilterQuery<Booking> = {
      organizationId: new Types.ObjectId(organizationId),
      resourceId: new Types.ObjectId(resourceId),
      status: { $in: ACTIVE_STATUSES },
      startAt: { $lt: endAt },
      ...occupiedAfter(startAt),
    };
    if (excludeBookingId)
      filter._id = { $ne: new Types.ObjectId(excludeBookingId) };
    return this.bookingModel
      .find(filter)
      .session(session ?? null)
      .exec();
  }

  findForResourceOnDay(
    organizationId: string,
    resourceId: string,
    dayStart: Date,
    dayEnd: Date,
  ): Promise<BookingDocument[]> {
    return this.bookingModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
        resourceId: new Types.ObjectId(resourceId),
        status: { $in: ACTIVE_STATUSES },
        startAt: { $lt: dayEnd },
        ...occupiedAfter(dayStart),
      })
      .sort({ startAt: 1 })
      .exec();
  }

  async update(
    organizationId: string,
    id: string,
    data: Partial<Booking>,
  ): Promise<BookingDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.bookingModel
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

  /** Global (org-agnostic) sweep candidate list for BookingReminderSchedulerService — same
   *  cross-tenant shape as InvoicesRepository.findOverdueCandidates, but looking forward
   *  (`startAt` upcoming) instead of backward (`dueDate` passed). */
  findUpcomingUnreminded(
    windowMs: number,
    limit = 100,
  ): Promise<BookingDocument[]> {
    const now = new Date();
    return this.bookingModel
      .find({
        status: { $in: ACTIVE_STATUSES },
        startAt: { $gte: now, $lt: new Date(now.getTime() + windowMs) },
        reminderSentAt: { $exists: false },
      })
      .limit(limit)
      .exec();
  }

  /**
   * Atomically marks a single booking as reminded, guarded by the SAME eligibility filter used
   * by findUpcomingUnreminded — so a booking cancelled/rescheduled concurrently between the
   * sweep's read and this write is left untouched (returns null), and re-running this on an
   * already-reminded booking is a no-op.
   */
  markReminderSentIfEligible(
    organizationId: string,
    id: string,
  ): Promise<BookingDocument | null> {
    return this.bookingModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
          status: { $in: ACTIVE_STATUSES },
          reminderSentAt: { $exists: false },
        },
        { reminderSentAt: new Date() },
        { new: true },
      )
      .exec();
  }

  /** Called on reschedule — a reminder already sent for the old time no longer applies to the
   *  new one. $unset (not the generic `update()`, which auto-$sets and would silently drop an
   *  `undefined` value rather than actually clearing the field). */
  clearReminderFlag(
    organizationId: string,
    id: string,
  ): Promise<BookingDocument | null> {
    return this.bookingModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
        },
        { $unset: { reminderSentAt: 1 } },
        { new: true },
      )
      .exec();
  }

  /** Bookings whose online deposit is past due and still unpaid — every organization. */
  findUnpaidDepositsDue(now: Date): Promise<BookingDocument[]> {
    return this.bookingModel
      .find({
        depositDueBy: { $lt: now },
        paymentStatus: 'unpaid',
        status: { $in: ['pending', 'confirmed'] },
      })
      .limit(200)
      .exec();
  }
}
