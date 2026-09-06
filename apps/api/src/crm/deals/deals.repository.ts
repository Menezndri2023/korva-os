import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Deal, DealDocument } from './schemas/deal.schema';
import type { Paginated } from '../contacts/contacts.repository';

export interface FindDealsOptions {
  page: number;
  limit: number;
  pipelineId?: string;
  stageId?: string;
  status?: string;
  ownerId?: string;
  contactId?: string;
  leadId?: string;
}

@Injectable()
export class DealsRepository {
  constructor(
    @InjectModel(Deal.name) private readonly dealModel: Model<DealDocument>,
  ) {}

  create(data: Partial<Deal>): Promise<DealDocument> {
    return this.dealModel.create(data);
  }

  findById(organizationId: string, id: string): Promise<DealDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.dealModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  async findAll(
    organizationId: string,
    options: FindDealsOptions,
  ): Promise<Paginated<DealDocument>> {
    const filter: FilterQuery<Deal> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (options.pipelineId)
      filter.pipelineId = new Types.ObjectId(options.pipelineId);
    if (options.stageId) filter.stageId = new Types.ObjectId(options.stageId);
    if (options.status) filter.status = options.status;
    if (options.ownerId) filter.ownerId = new Types.ObjectId(options.ownerId);
    if (options.contactId)
      filter.contactId = new Types.ObjectId(options.contactId);
    if (options.leadId) filter.leadId = new Types.ObjectId(options.leadId);

    const skip = (options.page - 1) * options.limit;
    const [data, total] = await Promise.all([
      this.dealModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(options.limit)
        .exec(),
      this.dealModel.countDocuments(filter).exec(),
    ]);

    return { data, total };
  }

  update(
    organizationId: string,
    id: string,
    data: Partial<Deal>,
  ): Promise<DealDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.dealModel
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
   * Dedicated `$unset` for reopening — the generic `update()` above relies on Mongoose's
   * implicit `$set` wrapping, which silently DROPS `undefined`-valued keys rather than clearing
   * them in MongoDB. `closedAt`/`lossReason` would otherwise keep their stale values after a
   * reopen (same gotcha as TicketsRepository.reopen).
   */
  reopen(organizationId: string, id: string): Promise<DealDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.dealModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
        },
        { $set: { status: 'open' }, $unset: { closedAt: '', lossReason: '' } },
        { new: true },
      )
      .exec();
  }
}
