import { z } from "zod";

export const analyticsOverviewQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type AnalyticsOverviewQuery = z.infer<typeof analyticsOverviewQuerySchema>;

export const analyticsRevenueQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  interval: z.enum(["day", "week", "month"]).default("day"),
});
export type AnalyticsRevenueQuery = z.infer<typeof analyticsRevenueQuerySchema>;

export const analyticsActivityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type AnalyticsActivityQuery = z.infer<typeof analyticsActivityQuerySchema>;
