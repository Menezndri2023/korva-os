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
  rating: number;
  comment?: string;
  createdAt: string;
  updatedAt: string;
}
