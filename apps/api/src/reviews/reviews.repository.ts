import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import type { ReviewEntity } from '@korva/types';
import { Review, ReviewDocument } from './schemas/review.schema';
import type { Paginated } from '../crm/contacts/contacts.repository';

export interface FindReviewsOptions {
  page: number;
  limit: number;
  entity?: ReviewEntity;
}

@Injectable()
export class ReviewsRepository {
  constructor(
    @InjectModel(Review.name)
    private readonly reviewModel: Model<ReviewDocument>,
  ) {}

  create(data: Partial<Review>): Promise<ReviewDocument> {
    return this.reviewModel.create(data);
  }

  findOneForContactAndEntity(
    organizationId: string,
    contactId: string,
    entity: ReviewEntity,
    entityId: string,
  ): Promise<ReviewDocument | null> {
    return this.reviewModel
      .findOne({
        organizationId: new Types.ObjectId(organizationId),
        contactId: new Types.ObjectId(contactId),
        entity,
        entityId: new Types.ObjectId(entityId),
      })
      .exec();
  }

  async findAll(
    organizationId: string,
    options: FindReviewsOptions,
  ): Promise<Paginated<ReviewDocument>> {
    const filter: FilterQuery<Review> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (options.entity) filter.entity = options.entity;

    const skip = (options.page - 1) * options.limit;
    const [data, total] = await Promise.all([
      this.reviewModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(options.limit)
        .exec(),
      this.reviewModel.countDocuments(filter).exec(),
    ]);
    return { data, total };
  }
}
