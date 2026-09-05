export const REVIEW_ENTITIES = ["order", "booking"] as const;
export type ReviewEntity = (typeof REVIEW_ENTITIES)[number];

/** A customer's rating/comment on their own completed order or booking — see
 *  apps/api/src/reviews/schemas/review.schema.ts for the full rationale. */
export interface Review {
  id: string;
  organizationId: string;
  contactId: string;
  entity: ReviewEntity;
  entityId: string;
  offerId?: string;
  rating: number;
  comment?: string;
  createdAt: string;
  updatedAt: string;
}

/** A single review as shown on a public storefront offer page — anonymized (no reviewer name),
 *  since a customer leaving a review never explicitly consented to public display of their
 *  identity the way a testimonial's author (curated/typed in by the organization) did. */
export interface PublicOfferReview {
  rating: number;
  comment?: string;
  createdAt: string;
}

export interface PublicOfferReviewSummary {
  average: number | null;
  count: number;
  reviews: PublicOfferReview[];
}
