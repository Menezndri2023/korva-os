import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Campaign, CampaignDocument } from './schemas/campaign.schema';
import type { CampaignRecipientStatus } from '@korva/types';
import type { Paginated } from '../../crm/contacts/contacts.repository';

export interface FindCampaignsOptions {
  page: number;
  limit: number;
}

@Injectable()
export class CampaignsRepository {
  constructor(
    @InjectModel(Campaign.name)
    private readonly campaignModel: Model<CampaignDocument>,
  ) {}

  create(data: Partial<Campaign>): Promise<CampaignDocument> {
    return this.campaignModel.create(data);
  }

  findById(
    organizationId: string,
    id: string,
  ): Promise<CampaignDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.campaignModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  async findAll(
    organizationId: string,
    options: FindCampaignsOptions,
  ): Promise<Paginated<CampaignDocument>> {
    const filter = { organizationId: new Types.ObjectId(organizationId) };
    const skip = (options.page - 1) * options.limit;
    const [data, total] = await Promise.all([
      this.campaignModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(options.limit)
        .exec(),
      this.campaignModel.countDocuments(filter).exec(),
    ]);
    return { data, total };
  }

  update(
    organizationId: string,
    id: string,
    data: Partial<Campaign>,
  ): Promise<CampaignDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.campaignModel
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

  /** Only from 'draft' — guards a relaunch of an already-sending/sent campaign at the data
   *  layer too, not just the service-level status check (defense in depth against a race
   *  between two concurrent "send" clicks). Returns null if the campaign wasn't in 'draft'. */
  markLaunching(
    organizationId: string,
    id: string,
    totalRecipients: number,
  ): Promise<CampaignDocument | null> {
    return this.campaignModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
          status: 'draft',
        },
        {
          status: 'sending',
          launchedAt: new Date(),
          'stats.totalRecipients': totalRecipients,
        },
        { new: true },
      )
      .exec();
  }

  /**
   * Atomically increments the matching outcome counter AND processedCount in one operation,
   * returning the POST-increment document — the only safe way to detect "this was the last
   * recipient" without a separate read-then-compare race between concurrently-finishing workers.
   */
  recordProgress(
    campaignId: string,
    outcome: Extract<CampaignRecipientStatus, 'sent' | 'failed' | 'skipped'>,
  ): Promise<CampaignDocument | null> {
    return this.campaignModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(campaignId) },
        { $inc: { [`stats.${outcome}Count`]: 1, 'stats.processedCount': 1 } },
        { new: true },
      )
      .exec();
  }

  markCompleted(campaignId: string): Promise<CampaignDocument | null> {
    return this.campaignModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(campaignId), status: 'sending' },
        { status: 'sent', completedAt: new Date() },
        { new: true },
      )
      .exec();
  }
}
