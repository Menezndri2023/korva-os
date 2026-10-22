import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types, UpdateQuery } from 'mongoose';
import type { ReviewEntity, ReviewStatus } from '@korva/types';
import { Review, ReviewDocument } from './schemas/review.schema';
import type { Paginated } from '../crm/contacts/contacts.repository';

export interface FindReviewsOptions {
  page: number;
  limit: number;
  entity?: ReviewEntity;
  status?: ReviewStatus;
}

/** Reviews written before moderation existed carry no status: they are published. */
const VISIBLE = { status: { $ne: 'hidden' } } as const;

export interface RatingSummary {
  average: number | null;
  count: number;
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
    if (options.status === 'hidden') filter.status = 'hidden';
    if (options.status === 'published') Object.assign(filter, VISIBLE);

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

  update(
    organizationId: string,
    id: string,
    update: UpdateQuery<Review>,
  ): Promise<ReviewDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.reviewModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
        },
        update,
        { new: true },
      )
      .exec();
  }

  /** Published reviews only — what a visitor is entitled to see. `offerId` narrows to one offer. */
  async getRatingSummary(
    organizationId: string,
    offerId?: string,
  ): Promise<RatingSummary> {
    const [result] = await this.reviewModel.aggregate<{
      average: number;
      count: number;
    }>([
      {
        $match: {
          organizationId: new Types.ObjectId(organizationId),
          ...(offerId ? { offerId: new Types.ObjectId(offerId) } : {}),
          ...VISIBLE,
        },
      },
      {
        $group: {
          _id: null,
          average: { $avg: '$rating' },
          count: { $sum: 1 },
        },
      },
    ]);
    if (!result) return { average: null, count: 0 };
    return {
      average: Math.round(result.average * 10) / 10,
      count: result.count,
    };
  }

  /** Everything, hidden included, per star — the owner's own dashboard. */
  async getStaffStats(organizationId: string): Promise<{
    perRating: { rating: number; count: number; hidden: number; sum: number }[];
  }> {
    const rows = await this.reviewModel.aggregate<{
      _id: number;
      count: number;
      hidden: number;
    }>([
      { $match: { organizationId: new Types.ObjectId(organizationId) } },
      {
        $group: {
          _id: '$rating',
          count: { $sum: 1 },
          hidden: {
            $sum: { $cond: [{ $eq: ['$status', 'hidden'] }, 1, 0] },
          },
        },
      },
    ]);
    return {
      perRating: rows.map((row) => ({
        rating: row._id,
        count: row.count,
        hidden: row.hidden,
        sum: row._id * row.count,
      })),
    };
  }

  findPublished(
    organizationId: string,
    page: number,
    limit: number,
    offerId?: string,
  ): Promise<ReviewDocument[]> {
    return this.reviewModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
        ...(offerId ? { offerId: new Types.ObjectId(offerId) } : {}),
        ...VISIBLE,
      })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .exec();
  }
}
