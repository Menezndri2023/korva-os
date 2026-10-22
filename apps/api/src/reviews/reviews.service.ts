import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type {
  Pagination,
  PublicReview,
  PublicReviewSummary,
  ReviewStats,
  ReviewStatus,
} from '@korva/types';
import type { CreateReviewInput } from '@korva/validation';
import { ReviewsRepository, FindReviewsOptions } from './reviews.repository';
import { ReviewDocument } from './schemas/review.schema';
import { Offer } from '../catalog/offers/schemas/offer.schema';
import { Organization } from '../organizations/schemas/organization.schema';

/** How many reviews the site's home page shows under its average. */
export const HOME_REVIEWS_SHOWN = 6;

/** "Awa K." from a contact — a first name alone when there is no last name, nothing when there
 *  is no first name (the review then shows as "Client vérifié"). */
export function reviewAuthorName(contact: {
  firstName?: string | null;
  lastName?: string | null;
}): string | undefined {
  const first = contact.firstName?.trim();
  if (!first) return undefined;
  const initial = contact.lastName?.trim().charAt(0);
  return initial ? `${first} ${initial.toUpperCase()}.` : first;
}

export interface CreateReviewOptions {
  offerId?: string;
  /** Already resolved by the caller from the contact when the customer chose to sign. */
  authorName?: string;
}

@Injectable()
export class ReviewsService {
  constructor(
    private readonly reviewsRepository: ReviewsRepository,
    @InjectModel(Offer.name) private readonly offerModel: Model<Offer>,
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<Organization>,
  ) {}

  /**
   * Ownership and eligibility (the entity actually belongs to this contact and is genuinely
   * completed) are checked by the caller BEFORE this is invoked — CustomerAuthService#createReview
   * (customer account) or PublicService#submitInvitedReview (signed link). This method's own
   * responsibility is strictly the write + the duplicate-review race.
   */
  async create(
    organizationId: string,
    contactId: string,
    input: Pick<
      CreateReviewInput,
      'entity' | 'entityId' | 'rating' | 'comment'
    >,
    options: CreateReviewOptions = {},
  ): Promise<ReviewDocument> {
    try {
      return await this.reviewsRepository.create({
        organizationId: new Types.ObjectId(organizationId),
        contactId: new Types.ObjectId(contactId),
        entity: input.entity,
        entityId: new Types.ObjectId(input.entityId),
        offerId: options.offerId
          ? new Types.ObjectId(options.offerId)
          : undefined,
        rating: input.rating,
        comment: input.comment || undefined,
        status: 'published',
        authorName: options.authorName,
      });
    } catch (error) {
      if (isDuplicateReviewError(error)) {
        throw new ConflictException({
          code: 'REVIEW_ALREADY_EXISTS',
          message: 'You have already reviewed this order or booking',
        });
      }
      throw error;
    }
  }

  hasReviewed(
    organizationId: string,
    contactId: string,
    entity: CreateReviewInput['entity'],
    entityId: string,
  ): Promise<boolean> {
    return this.reviewsRepository
      .findOneForContactAndEntity(organizationId, contactId, entity, entityId)
      .then(Boolean);
  }

  async list(
    organizationId: string,
    query: FindReviewsOptions,
  ): Promise<{
    data: (ReturnType<ReviewDocument['toJSON']> & { offerName?: string })[];
    pagination: Pagination;
  }> {
    const { data, total } = await this.reviewsRepository.findAll(
      organizationId,
      query,
    );
    const names = await this.offerNames(data);
    return {
      data: data.map((review) => ({
        ...review.toJSON(),
        offerName: review.offerId
          ? names.get(review.offerId.toString())
          : undefined,
      })),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  async stats(organizationId: string): Promise<ReviewStats> {
    const [{ perRating }, organization] = await Promise.all([
      this.reviewsRepository.getStaffStats(organizationId),
      this.organizationModel
        .findById(organizationId, { reviewRequestsEnabled: 1 })
        .lean()
        .exec(),
    ]);
    const distribution: ReviewStats['distribution'] = [0, 0, 0, 0, 0];
    let count = 0;
    let hidden = 0;
    let sum = 0;
    for (const row of perRating) {
      if (row.rating >= 1 && row.rating <= 5) {
        distribution[row.rating - 1] = row.count;
      }
      count += row.count;
      hidden += row.hidden;
      sum += row.sum;
    }
    return {
      average: count ? Math.round((sum / count) * 10) / 10 : null,
      count,
      hidden,
      distribution,
      requestsEnabled: organization?.reviewRequestsEnabled !== false,
    };
  }

  async setStatus(
    organizationId: string,
    id: string,
    status: ReviewStatus,
  ): Promise<ReviewDocument> {
    return this.mustExist(
      await this.reviewsRepository.update(organizationId, id, { status }),
    );
  }

  /** "" removes the answer. */
  async reply(
    organizationId: string,
    id: string,
    body: string,
  ): Promise<ReviewDocument> {
    const update = body
      ? { $set: { reply: { body, repliedAt: new Date() } } }
      : { $unset: { reply: 1 } };
    return this.mustExist(
      await this.reviewsRepository.update(organizationId, id, update),
    );
  }

  /** Public, unauthenticated summary for a storefront offer page — average rating + a page of
   *  published reviews. Returns a zero-state (`average: null, count: 0`) rather than throwing
   *  when an offer has no reviews yet, so the storefront can render "no reviews yet" instead of
   *  handling an error case. */
  async getPublicSummary(
    organizationId: string,
    offerId: string,
    page: number,
    limit: number,
  ): Promise<{
    average: number | null;
    count: number;
    reviews: PublicReview[];
  }> {
    const [{ average, count }, reviews] = await Promise.all([
      this.reviewsRepository.getRatingSummary(organizationId, offerId),
      this.reviewsRepository.findPublished(
        organizationId,
        page,
        limit,
        offerId,
      ),
    ]);
    return { average, count, reviews: reviews.map((r) => toPublicReview(r)) };
  }

  /** The whole business's rating and its latest published reviews — the home page section. */
  async getPublicOrganizationSummary(
    organizationId: string,
  ): Promise<PublicReviewSummary> {
    const [{ average, count }, latest] = await Promise.all([
      this.reviewsRepository.getRatingSummary(organizationId),
      this.reviewsRepository.findPublished(
        organizationId,
        1,
        HOME_REVIEWS_SHOWN,
      ),
    ]);
    const names = await this.offerNames(latest);
    return {
      average,
      count,
      latest: latest.map((review) =>
        toPublicReview(
          review,
          review.offerId ? names.get(review.offerId.toString()) : undefined,
        ),
      ),
    };
  }

  private async offerNames(
    reviews: ReviewDocument[],
  ): Promise<Map<string, string>> {
    const ids = [
      ...new Set(
        reviews
          .map((review) => review.offerId?.toString())
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (ids.length === 0) return new Map();
    const offers = await this.offerModel
      .find(
        { _id: { $in: ids.map((id) => new Types.ObjectId(id)) } },
        { name: 1 },
      )
      .lean()
      .exec();
    return new Map(offers.map((offer) => [String(offer._id), offer.name]));
  }

  private mustExist(review: ReviewDocument | null): ReviewDocument {
    if (!review) {
      throw new NotFoundException({
        code: 'REVIEW_NOT_FOUND',
        message: 'Review not found',
      });
    }
    return review;
  }
}

/** Never the contact id or the email: only what the customer chose to make public. */
export function toPublicReview(
  review: ReviewDocument,
  offerName?: string,
): PublicReview {
  return {
    rating: review.rating,
    comment: review.comment,
    createdAt: (
      review as unknown as { createdAt: Date }
    ).createdAt.toISOString(),
    authorName: review.authorName,
    reply: review.reply
      ? {
          body: review.reply.body,
          repliedAt: review.reply.repliedAt.toISOString(),
        }
      : undefined,
    offerName,
  };
}

/** Mirrors isDuplicateActionClaimError (WorkflowsRepository) / isDuplicateIdempotencyKeyError
 *  (PaymentsService) — the same MongoDB duplicate-key (11000) narrowing-by-index-name pattern
 *  already established elsewhere in this codebase. */
function isDuplicateReviewError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as Record<string, unknown>;
  return (
    code === 11000 &&
    typeof message === 'string' &&
    message.includes('contactId') &&
    message.includes('entity')
  );
}
