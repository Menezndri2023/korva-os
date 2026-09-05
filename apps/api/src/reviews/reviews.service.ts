import { ConflictException, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import type { Pagination } from '@korva/types';
import type { CreateReviewInput } from '@korva/validation';
import { ReviewsRepository, FindReviewsOptions } from './reviews.repository';
import { ReviewDocument } from './schemas/review.schema';

@Injectable()
export class ReviewsService {
  constructor(private readonly reviewsRepository: ReviewsRepository) {}

  /**
   * Ownership and eligibility (the entity actually belongs to this contact and is genuinely
   * completed) are checked by the caller BEFORE this is invoked — see
   * CustomerAuthService#createReview, which is the only real caller. This method's own
   * responsibility is strictly the write + the duplicate-review race.
   */
  async create(
    organizationId: string,
    contactId: string,
    input: CreateReviewInput,
    offerId?: string,
  ): Promise<ReviewDocument> {
    try {
      return await this.reviewsRepository.create({
        organizationId: new Types.ObjectId(organizationId),
        contactId: new Types.ObjectId(contactId),
        entity: input.entity,
        entityId: new Types.ObjectId(input.entityId),
        offerId: offerId ? new Types.ObjectId(offerId) : undefined,
        rating: input.rating,
        comment: input.comment,
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

  async list(
    organizationId: string,
    query: FindReviewsOptions,
  ): Promise<{ data: ReviewDocument[]; pagination: Pagination }> {
    const { data, total } = await this.reviewsRepository.findAll(
      organizationId,
      query,
    );
    return {
      data,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  /** Public, unauthenticated summary for a storefront offer page — average rating + a page of
   *  anonymized comments. Returns a zero-state (`average: null, count: 0`) rather than throwing
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
    reviews: ReviewDocument[];
  }> {
    const [{ average, count }, reviews] = await Promise.all([
      this.reviewsRepository.getRatingSummary(organizationId, offerId),
      this.reviewsRepository.findPublicByOffer(
        organizationId,
        offerId,
        page,
        limit,
      ),
    ]);
    return { average, count, reviews };
  }
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
