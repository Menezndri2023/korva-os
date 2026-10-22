import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type {
  PlatformReviewAdminRow,
  PlatformReviewStats,
  PlatformReviewStatus,
  PublicPlatformReviewSummary,
} from '@korva/types';
import type {
  ModeratePlatformReviewInput,
  UpsertPlatformReviewInput,
} from '@korva/validation';
import {
  PlatformReview,
  PlatformReviewDocument,
} from './schemas/platform-review.schema';
import { Organization } from '../organizations/schemas/organization.schema';
import { User } from '../identity/schemas/user.schema';

/** How many reviews korvasuite.com shows. */
export const PUBLIC_PLATFORM_REVIEWS_SHOWN = 9;

/** Rejected reviews are spam or abuse: they count for nothing, not even the average. */
const COUNTED: PlatformReviewStatus[] = ['pending', 'published'];

@Injectable()
export class PlatformReviewsService {
  constructor(
    @InjectModel(PlatformReview.name)
    private readonly reviewModel: Model<PlatformReviewDocument>,
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<Organization>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  getMine(userId: string, organizationId: string) {
    return this.reviewModel
      .findOne({
        userId: new Types.ObjectId(userId),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  /** Any change goes back to the administration before korvasuite.com shows it again. */
  async upsertMine(
    userId: string,
    organizationId: string,
    input: UpsertPlatformReviewInput,
  ): Promise<PlatformReviewDocument> {
    const [user, organization] = await Promise.all([
      this.userModel.findById(userId, { firstName: 1 }).lean().exec(),
      this.organizationModel
        .findById(organizationId, { name: 1 })
        .lean()
        .exec(),
    ]);
    if (!user || !organization) {
      throw new NotFoundException({
        code: 'ORGANIZATION_NOT_FOUND',
        message: 'Organization not found',
      });
    }
    return this.reviewModel
      .findOneAndUpdate(
        {
          userId: new Types.ObjectId(userId),
          organizationId: new Types.ObjectId(organizationId),
        },
        {
          $set: {
            rating: input.rating,
            comment: input.comment,
            publicConsent: input.publicConsent,
            displayName: user.firstName?.trim() || organization.name,
            businessName: organization.name,
            status: 'pending',
          },
          $unset: { rejectionReason: 1, moderatedAt: 1 },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  async publicSummary(): Promise<PublicPlatformReviewSummary> {
    const [aggregate, published] = await Promise.all([
      this.reviewModel.aggregate<{ average: number; count: number }>([
        { $match: { status: { $in: COUNTED } } },
        {
          $group: {
            _id: null,
            average: { $avg: '$rating' },
            count: { $sum: 1 },
          },
        },
      ]),
      this.reviewModel
        .find({ status: 'published', publicConsent: true })
        .sort({ rating: -1, updatedAt: -1 })
        .limit(PUBLIC_PLATFORM_REVIEWS_SHOWN)
        .lean()
        .exec(),
    ]);
    const models = await this.organizationModel
      .find(
        { _id: { $in: published.map((review) => review.organizationId) } },
        { businessModel: 1 },
      )
      .lean()
      .exec();
    const modelOf = new Map(
      models.map((org) => [String(org._id), org.businessModel]),
    );
    const [summary] = aggregate;
    return {
      average: summary ? Math.round(summary.average * 10) / 10 : null,
      count: summary?.count ?? 0,
      reviews: published.map((review) => ({
        rating: review.rating,
        comment: review.comment,
        displayName: review.displayName,
        businessName: review.businessName,
        businessModel: modelOf.get(String(review.organizationId)),
        createdAt: (
          review as unknown as { createdAt: Date }
        ).createdAt.toISOString(),
      })),
    };
  }

  async adminList(
    status?: PlatformReviewStatus,
  ): Promise<PlatformReviewAdminRow[]> {
    const reviews = await this.reviewModel
      .find(status ? { status } : {})
      .sort({ createdAt: -1 })
      .limit(500)
      .exec();
    const [users, organizations] = await Promise.all([
      this.userModel
        .find({ _id: { $in: reviews.map((r) => r.userId) } }, { email: 1 })
        .lean()
        .exec(),
      this.organizationModel
        .find(
          { _id: { $in: reviews.map((r) => r.organizationId) } },
          { slug: 1 },
        )
        .lean()
        .exec(),
    ]);
    const emails = new Map(users.map((u) => [String(u._id), u.email]));
    const slugs = new Map(organizations.map((o) => [String(o._id), o.slug]));
    // Dates stay Date objects here; the HTTP layer serializes them to the ISO strings the type
    // describes.
    return reviews.map(
      (review) =>
        ({
          ...review.toJSON(),
          authorEmail: emails.get(review.userId.toString()),
          organizationSlug: slugs.get(review.organizationId.toString()),
        }) as unknown as PlatformReviewAdminRow,
    );
  }

  async adminStats(): Promise<PlatformReviewStats> {
    const rows = await this.reviewModel.aggregate<{
      _id: { status: PlatformReviewStatus; rating: number };
      count: number;
    }>([
      {
        $group: {
          _id: { status: '$status', rating: '$rating' },
          count: { $sum: 1 },
        },
      },
    ]);
    const stats: PlatformReviewStats = {
      average: null,
      count: 0,
      pending: 0,
      published: 0,
      rejected: 0,
      distribution: [0, 0, 0, 0, 0],
    };
    let sum = 0;
    for (const row of rows) {
      stats[row._id.status] += row.count;
      if (!COUNTED.includes(row._id.status)) continue;
      stats.count += row.count;
      sum += row._id.rating * row.count;
      if (row._id.rating >= 1 && row._id.rating <= 5) {
        stats.distribution[row._id.rating - 1]! += row.count;
      }
    }
    stats.average = stats.count
      ? Math.round((sum / stats.count) * 10) / 10
      : null;
    return stats;
  }

  async moderate(
    id: string,
    input: ModeratePlatformReviewInput,
  ): Promise<PlatformReviewDocument> {
    const review = Types.ObjectId.isValid(id)
      ? await this.reviewModel.findById(id).exec()
      : null;
    if (!review) {
      throw new NotFoundException({
        code: 'REVIEW_NOT_FOUND',
        message: 'Review not found',
      });
    }
    // Never put words on korvasuite.com that their author did not agree to show there.
    if (input.status === 'published' && !review.publicConsent) {
      throw new BadRequestException({
        code: 'REVIEW_NOT_CONSENTED',
        message: 'The author did not agree to a public display',
      });
    }
    review.status = input.status;
    review.moderatedAt = new Date();
    review.rejectionReason =
      input.status === 'rejected' ? input.reason || undefined : undefined;
    return review.save();
  }
}
