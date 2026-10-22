import { z } from "zod";
import { REVIEW_ENTITIES, REVIEW_STATUSES } from "@korva/types";

const rating = z.number().int().min(1).max(5);
const comment = z.string().trim().max(2000).optional();

/** Created only by an authenticated customer, for their own already-completed order/booking —
 *  see CustomerAuthService#createReview. Never staff-created/editable. */
export const createReviewSchema = z.object({
  entity: z.enum(REVIEW_ENTITIES),
  entityId: z.string().min(1),
  rating,
  comment,
  /** Sign with "Prénom N." instead of "Client vérifié". */
  showName: z.boolean().optional(),
});
export type CreateReviewInput = z.infer<typeof createReviewSchema>;

/** The same review, from the link sent after a delivered order / completed booking — no
 *  customer account needed; the signed token is the proof of purchase. */
export const submitInvitedReviewSchema = z.object({
  token: z.string().min(20).max(1000),
  rating,
  comment,
  showName: z.boolean().optional(),
});
export type SubmitInvitedReviewInput = z.infer<typeof submitInvitedReviewSchema>;

export const reviewInvitationQuerySchema = z.object({
  token: z.string().min(20).max(1000),
});
export type ReviewInvitationQuery = z.infer<typeof reviewInvitationQuerySchema>;

export const listReviewsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  entity: z.enum(REVIEW_ENTITIES).optional(),
  status: z.enum(REVIEW_STATUSES).optional(),
});
export type ListReviewsQuery = z.infer<typeof listReviewsQuerySchema>;

export const updateReviewStatusSchema = z.object({
  status: z.enum(REVIEW_STATUSES),
});
export type UpdateReviewStatusInput = z.infer<typeof updateReviewStatusSchema>;

/** The business's public answer, shown under the review. "" removes it. */
export const replyToReviewSchema = z.object({
  body: z.string().trim().max(1000),
});
export type ReplyToReviewInput = z.infer<typeof replyToReviewSchema>;

/** Public storefront offer-page pagination — no `entity` filter (a public review summary is
 *  always scoped to one offer, already selected via the URL path, not by entity type). */
export const publicOfferReviewsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type PublicOfferReviewsQuery = z.infer<typeof publicOfferReviewsQuerySchema>;

/* ─── Reviews of KORVA OS by the businesses using it ─── */

export const upsertPlatformReviewSchema = z.object({
  rating,
  comment: z
    .string()
    .trim()
    .min(10, "Dites-nous en quelques mots (10 caractères minimum).")
    .max(1000),
  publicConsent: z.boolean(),
});
export type UpsertPlatformReviewInput = z.infer<typeof upsertPlatformReviewSchema>;

export const listPlatformReviewsQuerySchema = z.object({
  status: z.enum(["pending", "published", "rejected"]).optional(),
});
export type ListPlatformReviewsQuery = z.infer<typeof listPlatformReviewsQuerySchema>;

export const moderatePlatformReviewSchema = z.object({
  status: z.enum(["published", "rejected"]),
  /** Told to the author on their review page when declined. */
  reason: z.string().trim().max(300).optional(),
});
export type ModeratePlatformReviewInput = z.infer<typeof moderatePlatformReviewSchema>;
