import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { SegmentCriteria } from '@korva/types';
import { Segment, SegmentDocument } from './schemas/segment.schema';
import {
  Contact,
  ContactDocument,
} from '../../crm/contacts/schemas/contact.schema';
import type { Paginated } from '../../crm/contacts/contacts.repository';
import { buildContactFilter } from './segment-query-builder';

export interface FindSegmentsOptions {
  page: number;
  limit: number;
}

@Injectable()
export class SegmentsRepository {
  constructor(
    @InjectModel(Segment.name)
    private readonly segmentModel: Model<SegmentDocument>,
    // Registered locally by MarketingModule (not via CrmModule) to avoid a circular module
    // dependency — same "register a schema locally" pattern CrmModule itself already uses for
    // Order/Booking/Invoice/etc. See crm.module.ts's own doc comment for the precedent.
    @InjectModel(Contact.name)
    private readonly contactModel: Model<ContactDocument>,
  ) {}

  create(data: Partial<Segment>): Promise<SegmentDocument> {
    return this.segmentModel.create(data);
  }

  findById(
    organizationId: string,
    id: string,
  ): Promise<SegmentDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.segmentModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  async findAll(
    organizationId: string,
    options: FindSegmentsOptions,
  ): Promise<Paginated<SegmentDocument>> {
    const filter = { organizationId: new Types.ObjectId(organizationId) };
    const skip = (options.page - 1) * options.limit;
    const [data, total] = await Promise.all([
      this.segmentModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(options.limit)
        .exec(),
      this.segmentModel.countDocuments(filter).exec(),
    ]);
    return { data, total };
  }

  async update(
    organizationId: string,
    id: string,
    data: Partial<Segment>,
  ): Promise<SegmentDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.segmentModel
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
    const res = await this.segmentModel
      .deleteOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
    return res.deletedCount > 0;
  }

  countMatchingContacts(
    organizationId: string,
    criteria: SegmentCriteria,
  ): Promise<number> {
    return this.contactModel
      .countDocuments(buildContactFilter(organizationId, criteria))
      .exec();
  }

  /**
   * Only ids, not full documents — used by CampaignsService.launch to fan out one job per
   * contact. Bounded at 20,000 (a generous cap for an SME's contact list) rather than an
   * unbounded/streaming read — this codebase's other "process many" jobs (the inactivity/
   * booking-reminder/invoice-overdue schedulers) all use the same bounded-`.limit()` idiom
   * instead of a Mongo cursor, which has no precedent anywhere else in this codebase.
   */
  async matchContactIds(
    organizationId: string,
    criteria: SegmentCriteria,
  ): Promise<string[]> {
    const docs = await this.contactModel
      .find(buildContactFilter(organizationId, criteria))
      .select('_id')
      .limit(20_000)
      .lean()
      .exec();
    return docs.map((doc) => doc._id.toString());
  }
}
