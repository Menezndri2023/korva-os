import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CampaignRecipient,
  CampaignRecipientDocument,
} from './schemas/campaign-recipient.schema';
import type { Paginated } from '../../crm/contacts/contacts.repository';

export interface FindCampaignRecipientsOptions {
  page: number;
  limit: number;
}

@Injectable()
export class CampaignRecipientsRepository {
  constructor(
    @InjectModel(CampaignRecipient.name)
    private readonly recipientModel: Model<CampaignRecipientDocument>,
  ) {}

  /** `ordered: false` — a relaunch that re-inserts an already-enqueued contact hits the unique
   *  {campaignId,contactId} index and is skipped individually, without aborting the rest of the
   *  batch. */
  insertMany(
    data: Partial<CampaignRecipient>[],
  ): Promise<CampaignRecipientDocument[]> {
    return this.recipientModel.insertMany(data, { ordered: false });
  }

  findById(id: string): Promise<CampaignRecipientDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.recipientModel.findById(id).exec();
  }

  async findAll(
    organizationId: string,
    campaignId: string,
    options: FindCampaignRecipientsOptions,
  ): Promise<Paginated<CampaignRecipientDocument>> {
    if (!Types.ObjectId.isValid(campaignId)) return { data: [], total: 0 };
    const filter = {
      organizationId: new Types.ObjectId(organizationId),
      campaignId: new Types.ObjectId(campaignId),
    };
    const skip = (options.page - 1) * options.limit;
    const [data, total] = await Promise.all([
      this.recipientModel
        .find(filter)
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(options.limit)
        .exec(),
      this.recipientModel.countDocuments(filter).exec(),
    ]);
    return { data, total };
  }

  /**
   * Conditioned on `status: 'pending'` in the filter itself — this is the idempotency guard a
   * BullMQ retry relies on: a job that runs twice (the first attempt's send genuinely succeeded
   * but the DB write that would have recorded it failed) can only ever have its outcome recorded
   * once. Returns null when the filter didn't match (already processed by an earlier attempt),
   * which the worker uses to skip the campaign-level stats increment too.
   */
  recordOutcome(
    recipientId: string,
    status: 'sent' | 'failed' | 'skipped',
    channelUsed?: 'whatsapp' | 'email',
    error?: string,
  ): Promise<CampaignRecipientDocument | null> {
    if (!Types.ObjectId.isValid(recipientId)) return Promise.resolve(null);
    return this.recipientModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(recipientId), status: 'pending' },
        {
          status,
          ...(channelUsed ? { channelUsed } : {}),
          ...(error ? { error } : {}),
          ...(status === 'sent' ? { sentAt: new Date() } : {}),
        },
        { new: true },
      )
      .exec();
  }
}
