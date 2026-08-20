import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Quote, QuoteDocument } from './schemas/quote.schema';
import type { Paginated } from '../../crm/contacts/contacts.repository';

export interface FindQuotesOptions {
  page: number;
  limit: number;
  status?: string;
  contactId?: string;
}

@Injectable()
export class QuotesRepository {
  constructor(
    @InjectModel(Quote.name) private readonly quoteModel: Model<QuoteDocument>,
  ) {}

  create(data: Partial<Quote>): Promise<QuoteDocument> {
    return this.quoteModel.create(data);
  }

  findById(organizationId: string, id: string): Promise<QuoteDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.quoteModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  async findAll(
    organizationId: string,
    options: FindQuotesOptions,
  ): Promise<Paginated<QuoteDocument>> {
    const filter: FilterQuery<Quote> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (options.status) filter.status = options.status;
    if (options.contactId)
      filter.contactId = new Types.ObjectId(options.contactId);

    const skip = (options.page - 1) * options.limit;
    const [data, total] = await Promise.all([
      this.quoteModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(options.limit)
        .exec(),
      this.quoteModel.countDocuments(filter).exec(),
    ]);

    return { data, total };
  }

  async update(
    organizationId: string,
    id: string,
    data: Partial<Quote>,
  ): Promise<QuoteDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.quoteModel
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
