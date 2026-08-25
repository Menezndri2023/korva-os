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
      endAt: { $gt: startAt },
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
        endAt: { $gt: dayStart },
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
}
