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

/** The period of the Pro statistics; the comparison is always against the same length before it. */
export const analyticsInsightsQuerySchema = z.object({
  days: z.coerce.number().int().refine((value) => [7, 30, 90, 365].includes(value)).default(30),
});
export type AnalyticsInsightsQuery = z.infer<typeof analyticsInsightsQuerySchema>;

const exportDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

/** An export's period, in calendar days; both ends included. Defaults to the last 30 days. */
export const dataExportQuerySchema = z
  .object({ from: exportDay.optional(), to: exportDay.optional() })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: "from must not be after to",
    path: ["from"],
  });
export type DataExportQuery = z.infer<typeof dataExportQuerySchema>;
