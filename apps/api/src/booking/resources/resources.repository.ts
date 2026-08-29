import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Resource,
  ResourceDocument,
  BlockedSlot,
} from './schemas/resource.schema';

@Injectable()
export class ResourcesRepository {
  constructor(
    @InjectModel(Resource.name)
    private readonly resourceModel: Model<ResourceDocument>,
  ) {}

  create(data: Partial<Resource>): Promise<ResourceDocument> {
    return this.resourceModel.create(data);
  }

  findById(
    organizationId: string,
    id: string,
  ): Promise<ResourceDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.resourceModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  findAll(
    organizationId: string,
    activeOnly: boolean,
  ): Promise<ResourceDocument[]> {
    const filter: Record<string, unknown> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (activeOnly) filter.active = true;
    return this.resourceModel.find(filter).sort({ name: 1 }).exec();
  }

  async update(
    organizationId: string,
    id: string,
    data: Partial<Resource>,
  ): Promise<ResourceDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.resourceModel
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

  async addBlockedSlot(
    organizationId: string,
    id: string,
    slot: Partial<BlockedSlot>,
  ): Promise<ResourceDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.resourceModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
        },
        { $push: { blockedSlots: slot } },
        { new: true },
      )
      .exec();
  }

  async removeBlockedSlot(
    organizationId: string,
    id: string,
    slotId: string,
  ): Promise<ResourceDocument | null> {
    if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(slotId))
      return null;
    return this.resourceModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
        },
        { $pull: { blockedSlots: { _id: new Types.ObjectId(slotId) } } },
        { new: true },
      )
      .exec();
  }

  /**
   * Used by CalendarSyncSchedulerService's global sweep (no organizationId — same cross-tenant
   * background-job shape as the quote-expiry/invoice-overdue/customer-inactivity schedulers).
   */
  findAllWithExternalCalendar(limit = 200): Promise<ResourceDocument[]> {
    return this.resourceModel
      .find({ externalCalendarUrl: { $exists: true, $ne: null } })
      .limit(limit)
      .exec();
  }

  /**
   * Wholesale-replaces every blocked slot this sync previously wrote (`source:
   * 'external_calendar'`) with the freshly parsed set, leaving every manually-added slot (no
   * `source` at all) completely untouched. MongoDB rejects $pull and $push on the same array
   * path within a single update, hence the two separate calls — acceptable here since this is
   * the only writer of `source: 'external_calendar'` slots and runs on its own schedule, not
   * racing a concurrent user edit to this same field.
   */
  async replaceExternalCalendarBlockedSlots(
    organizationId: string,
    id: string,
    slots: Partial<BlockedSlot>[],
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    const filter = {
      _id: new Types.ObjectId(id),
      organizationId: new Types.ObjectId(organizationId),
    };
    const pulled = await this.resourceModel
      .updateOne(filter, {
        $pull: { blockedSlots: { source: 'external_calendar' } },
      })
      .exec();
    if (pulled.matchedCount === 0) return false;
    if (slots.length > 0) {
      await this.resourceModel
        .updateOne(filter, { $push: { blockedSlots: { $each: slots } } })
        .exec();
    }
    return true;
  }
}
