import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
import { TimeEntry, TimeEntryDocument } from './schemas/time-entry.schema';
import type { Paginated } from '../../crm/contacts/contacts.repository';

export interface FindTimeEntriesOptions {
  page: number;
  limit: number;
  status?: string;
  contactId?: string;
  userId?: string;
  billable?: boolean;
}

@Injectable()
export class TimeEntriesRepository {
  constructor(
    @InjectModel(TimeEntry.name)
    private readonly timeEntryModel: Model<TimeEntryDocument>,
  ) {}

  create(data: Partial<TimeEntry>): Promise<TimeEntryDocument> {
    return this.timeEntryModel.create(data);
  }

  findById(
    organizationId: string,
    id: string,
  ): Promise<TimeEntryDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.timeEntryModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  /** Used by generateInvoice's pre-transaction validation — no pagination, bounded by the caller's own id list. */
  findByIds(
    organizationId: string,
    ids: string[],
  ): Promise<TimeEntryDocument[]> {
    const validIds = ids.filter((id) => Types.ObjectId.isValid(id));
    return this.timeEntryModel
      .find({
        _id: { $in: validIds.map((id) => new Types.ObjectId(id)) },
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  async findAll(
    organizationId: string,
    options: FindTimeEntriesOptions,
  ): Promise<Paginated<TimeEntryDocument>> {
    const filter: FilterQuery<TimeEntry> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (options.status) filter.status = options.status;
    if (options.contactId)
      filter.contactId = new Types.ObjectId(options.contactId);
    if (options.userId) filter.userId = new Types.ObjectId(options.userId);
    if (options.billable !== undefined) filter.billable = options.billable;

    const skip = (options.page - 1) * options.limit;
    const [data, total] = await Promise.all([
      this.timeEntryModel
        .find(filter)
        .sort({ date: -1, createdAt: -1 })
        .skip(skip)
        .limit(options.limit)
        .exec(),
      this.timeEntryModel.countDocuments(filter).exec(),
    ]);

    return { data, total };
  }

  async update(
    organizationId: string,
    id: string,
    data: Partial<TimeEntry>,
  ): Promise<TimeEntryDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.timeEntryModel
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

  async delete(organizationId: string, id: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    const res = await this.timeEntryModel
      .deleteOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
    return res.deletedCount > 0;
  }

  /**
   * Atomically flips every listed entry to 'invoiced' — but only entries still 'approved' and
   * not yet linked to an invoice actually match. If a concurrent generateInvoice call already
   * claimed one of these entries, matchedCount comes back lower than ids.length, which the
   * caller (TimeEntriesService.generateInvoice) turns into a clean business error instead of an
   * inconsistent partially-invoiced state — see that method's transaction for the full story.
   */
  async markInvoiced(
    organizationId: string,
    ids: string[],
    invoiceId: string,
    session: ClientSession,
  ): Promise<{ matchedCount: number }> {
    const res = await this.timeEntryModel
      .updateMany(
        {
          _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
          organizationId: new Types.ObjectId(organizationId),
          status: 'approved',
          invoiceId: { $exists: false },
        },
        { status: 'invoiced', invoiceId: new Types.ObjectId(invoiceId) },
        { session },
      )
      .exec();
    return { matchedCount: res.matchedCount };
  }
}
