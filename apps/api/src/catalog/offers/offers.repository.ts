import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Offer, OfferDocument } from './schemas/offer.schema';
import type { Paginated } from '../../crm/contacts/contacts.repository';

export interface FindOffersOptions {
  page: number;
  limit: number;
  search?: string;
  type?: string;
  status?: string;
  category?: string;
}

@Injectable()
export class OffersRepository {
  constructor(
    @InjectModel(Offer.name) private readonly offerModel: Model<OfferDocument>,
  ) {}

  create(data: Partial<Offer>): Promise<OfferDocument> {
    return this.offerModel.create(data);
  }

  findById(organizationId: string, id: string): Promise<OfferDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.offerModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  async findAll(
    organizationId: string,
    options: FindOffersOptions,
  ): Promise<Paginated<OfferDocument>> {
    const filter: FilterQuery<Offer> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (options.type) filter.type = options.type;
    if (options.status) filter.status = options.status;
    if (options.category) filter.categories = options.category;
    if (options.search) filter.$text = { $search: options.search };

    const skip = (options.page - 1) * options.limit;
    const [data, total] = await Promise.all([
      this.offerModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(options.limit)
        .exec(),
      this.offerModel.countDocuments(filter).exec(),
    ]);

    return { data, total };
  }

  async update(
    organizationId: string,
    id: string,
    data: Partial<Offer>,
  ): Promise<OfferDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.offerModel
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
    const res = await this.offerModel
      .deleteOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
    return res.deletedCount > 0;
  }
}
