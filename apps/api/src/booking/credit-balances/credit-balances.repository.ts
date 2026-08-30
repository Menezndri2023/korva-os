import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  CreditBalance,
  CreditBalanceDocument,
} from './schemas/credit-balance.schema';
import type { Paginated } from '../../crm/contacts/contacts.repository';

export interface FindCreditBalancesOptions {
  page: number;
  limit: number;
  contactId?: string;
  offerId?: string;
}

@Injectable()
export class CreditBalancesRepository {
  constructor(
    @InjectModel(CreditBalance.name)
    private readonly creditBalanceModel: Model<CreditBalanceDocument>,
  ) {}

  findById(
    organizationId: string,
    id: string,
  ): Promise<CreditBalanceDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.creditBalanceModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  /** Upserts: creates the (org, contact, offer) row on first purchase, otherwise adds `credits`
   *  to both the lifetime total and the live balance. */
  topUp(
    organizationId: string,
    contactId: string,
    offerId: string,
    credits: number,
  ): Promise<CreditBalanceDocument> {
    return this.creditBalanceModel
      .findOneAndUpdate(
        {
          organizationId: new Types.ObjectId(organizationId),
          contactId: new Types.ObjectId(contactId),
          offerId: new Types.ObjectId(offerId),
        },
        { $inc: { totalCredits: credits, remainingCredits: credits } },
        { new: true, upsert: true },
      )
      .exec();
  }

  /** Atomic guard — only decrements a balance that actually has at least one credit left, so two
   *  concurrent completions can never drive `remainingCredits` negative. Returns null if there's
   *  no balance for this contact+offer, or it's already depleted. */
  decrementIfAvailable(
    organizationId: string,
    contactId: string,
    offerId: string,
  ): Promise<CreditBalanceDocument | null> {
    return this.creditBalanceModel
      .findOneAndUpdate(
        {
          organizationId: new Types.ObjectId(organizationId),
          contactId: new Types.ObjectId(contactId),
          offerId: new Types.ObjectId(offerId),
          remainingCredits: { $gte: 1 },
        },
        { $inc: { remainingCredits: -1 } },
        { new: true },
      )
      .exec();
  }

  async findAll(
    organizationId: string,
    options: FindCreditBalancesOptions,
  ): Promise<Paginated<CreditBalanceDocument>> {
    const filter: FilterQuery<CreditBalance> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (options.contactId)
      filter.contactId = new Types.ObjectId(options.contactId);
    if (options.offerId) filter.offerId = new Types.ObjectId(options.offerId);

    const skip = (options.page - 1) * options.limit;
    const [data, total] = await Promise.all([
      this.creditBalanceModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(options.limit)
        .exec(),
      this.creditBalanceModel.countDocuments(filter).exec(),
    ]);
    return { data, total };
  }
}
