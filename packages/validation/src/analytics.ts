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

export const inventoryTurnoverQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});
export type InventoryTurnoverQuery = z.infer<typeof inventoryTurnoverQuerySchema>;

export const inventoryDeadStockQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(90),
});
export type InventoryDeadStockQuery = z.infer<typeof inventoryDeadStockQuerySchema>;
