import { z } from "zod";
import { REVIEW_ENTITIES } from "@korva/types";

/** Created only by an authenticated customer, for their own already-completed order/booking —
 *  see CustomerAuthService#createReview. Never staff-created/editable. */
export const createReviewSchema = z.object({
  entity: z.enum(REVIEW_ENTITIES),
  entityId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});
export type CreateReviewInput = z.infer<typeof createReviewSchema>;

export const listReviewsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  entity: z.enum(REVIEW_ENTITIES).optional(),
});
export type ListReviewsQuery = z.infer<typeof listReviewsQuerySchema>;
