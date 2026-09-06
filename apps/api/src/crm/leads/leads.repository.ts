import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Lead, LeadDocument } from './schemas/lead.schema';
import type { Paginated } from '../contacts/contacts.repository';

export interface FindLeadsOptions {
  page: number;
  limit: number;
  status?: string;
  ownerId?: string;
  contactId?: string;
}

@Injectable()
export class LeadsRepository {
  constructor(
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
  ) {}

  create(data: Partial<Lead>): Promise<LeadDocument> {
    return this.leadModel.create(data);
  }

  findById(organizationId: string, id: string): Promise<LeadDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.leadModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  async findAll(
    organizationId: string,
    options: FindLeadsOptions,
  ): Promise<Paginated<LeadDocument>> {
    const filter: FilterQuery<Lead> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (options.status) filter.status = options.status;
    if (options.ownerId) filter.ownerId = new Types.ObjectId(options.ownerId);
    if (options.contactId)
      filter.contactId = new Types.ObjectId(options.contactId);

    const skip = (options.page - 1) * options.limit;
    const [data, total] = await Promise.all([
      this.leadModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(options.limit)
        .exec(),
      this.leadModel.countDocuments(filter).exec(),
    ]);

    return { data, total };
  }

  async update(
    organizationId: string,
    id: string,
    data: Partial<Lead>,
  ): Promise<LeadDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.leadModel
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
   * One row per owner currently holding at least one active (not-yet-converted) lead — backs
   * LeadsService's least-loaded auto-routing (Phase D4, docs/KORVA_OS_V2_AUDIT.md §2.5). A single
   * aggregation rather than one count() per candidate owner, so routing a new lead never costs
   * more than one extra query regardless of team size.
   */
  async countActiveByOwner(
    organizationId: string,
  ): Promise<Map<string, number>> {
    const rows = await this.leadModel.aggregate<{
      _id: Types.ObjectId;
      count: number;
    }>([
      {
        $match: {
          organizationId: new Types.ObjectId(organizationId),
          status: { $ne: 'converted' },
          ownerId: { $exists: true },
        },
      },
      { $group: { _id: '$ownerId', count: { $sum: 1 } } },
    ]);
    return new Map(rows.map((row) => [row._id.toString(), row.count]));
  }
}
