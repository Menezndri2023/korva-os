import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  WaitlistEntry,
  WaitlistEntryDocument,
} from './schemas/waitlist-entry.schema';
import type { Paginated } from '../../crm/contacts/contacts.repository';

export interface FindWaitlistEntriesOptions {
  page: number;
  limit: number;
  resourceId?: string;
  contactId?: string;
  status?: string;
}

@Injectable()
export class WaitlistRepository {
  constructor(
    @InjectModel(WaitlistEntry.name)
    private readonly waitlistEntryModel: Model<WaitlistEntryDocument>,
  ) {}

  create(data: Partial<WaitlistEntry>): Promise<WaitlistEntryDocument> {
    return this.waitlistEntryModel.create(data);
  }

  findById(
    organizationId: string,
    id: string,
  ): Promise<WaitlistEntryDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.waitlistEntryModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  async findAll(
    organizationId: string,
    options: FindWaitlistEntriesOptions,
  ): Promise<Paginated<WaitlistEntryDocument>> {
    const filter: FilterQuery<WaitlistEntry> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (options.resourceId)
      filter.resourceId = new Types.ObjectId(options.resourceId);
    if (options.contactId)
      filter.contactId = new Types.ObjectId(options.contactId);
    if (options.status) filter.status = options.status;

    const skip = (options.page - 1) * options.limit;
    const [data, total] = await Promise.all([
      this.waitlistEntryModel
        .find(filter)
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(options.limit)
        .exec(),
      this.waitlistEntryModel.countDocuments(filter).exec(),
    ]);
    return { data, total };
  }

  /**
   * Waiting entries for a resource whose desired [startAt, endAt) overlaps the slot that just
   * freed up, oldest first (FIFO — first come, first notified). Used by
   * WaitlistService.handleBookingCancelled.
   */
  findWaitingOverlapping(
    organizationId: string,
    resourceId: string,
    startAt: Date,
    endAt: Date,
  ): Promise<WaitlistEntryDocument[]> {
    return this.waitlistEntryModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
        resourceId: new Types.ObjectId(resourceId),
        status: 'waiting',
        startAt: { $lt: endAt },
        endAt: { $gt: startAt },
      })
      .sort({ createdAt: 1 })
      .exec();
  }

  /** Atomic guard — only a still-'waiting' entry can be marked notified, so two concurrent
   *  cancellations racing to notify the same entry can never both "win". */
  markNotifiedIfWaiting(
    organizationId: string,
    id: string,
  ): Promise<WaitlistEntryDocument | null> {
    return this.waitlistEntryModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
          status: 'waiting',
        },
        { status: 'notified', notifiedAt: new Date() },
        { new: true },
      )
      .exec();
  }

  async cancel(
    organizationId: string,
    id: string,
  ): Promise<WaitlistEntryDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.waitlistEntryModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
        },
        { status: 'cancelled' },
        { new: true },
      )
      .exec();
  }
}
