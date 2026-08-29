import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import type { RecommendationStatus } from '@korva/types';
import type { Paginated } from '../crm/contacts/contacts.repository';
import {
  Recommendation,
  RecommendationDocument,
} from './schemas/recommendation.schema';

export interface FindRecommendationsOptions {
  page: number;
  limit: number;
  status?: RecommendationStatus;
}

@Injectable()
export class RecommendationsRepository {
  constructor(
    @InjectModel(Recommendation.name)
    private readonly recommendationModel: Model<RecommendationDocument>,
  ) {}

  /**
   * Creates the recommendation unless one already exists for this exact (ruleKey, entityType,
   * entityId) — relies on RecommendationSchema's unique index rather than a separate read,
   * so two concurrent evaluations of the same entity (e.g. a retried event job) can never race
   * into two documents. Returns null, not an error, on the duplicate case — the caller (a rule)
   * treats "already recommended" as a normal, expected outcome, not a failure.
   */
  async createIfNotExists(
    data: Partial<Recommendation>,
  ): Promise<RecommendationDocument | null> {
    try {
      return await this.recommendationModel.create(data);
    } catch (error) {
      if (isDuplicateKeyError(error)) return null;
      throw error;
    }
  }

  findById(
    organizationId: string,
    id: string,
  ): Promise<RecommendationDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.recommendationModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  async findAll(
    organizationId: string,
    options: FindRecommendationsOptions,
  ): Promise<Paginated<RecommendationDocument>> {
    const filter: FilterQuery<Recommendation> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (options.status) filter.status = options.status;

    const skip = (options.page - 1) * options.limit;
    const [data, total] = await Promise.all([
      this.recommendationModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(options.limit)
        .exec(),
      this.recommendationModel.countDocuments(filter).exec(),
    ]);

    return { data, total };
  }

  async updateStatus(
    organizationId: string,
    id: string,
    status: RecommendationStatus,
  ): Promise<RecommendationDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.recommendationModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
        },
        { status },
        { new: true },
      )
      .exec();
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}
