import { z } from "zod";
import { RECOMMENDATION_STATUSES } from "@korva/types";

export const listRecommendationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(RECOMMENDATION_STATUSES).optional(),
});
export type ListRecommendationsQuery = z.infer<
  typeof listRecommendationsQuerySchema
>;
