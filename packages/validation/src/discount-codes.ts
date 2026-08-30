import { z } from "zod";
import { DISCOUNT_CODE_SCOPES, DISCOUNT_CODE_TYPES } from "@korva/types";

export const createDiscountCodeSchema = z
  .object({
    code: z.string().min(1).max(40),
    type: z.enum(DISCOUNT_CODE_TYPES),
    value: z.number().positive(),
    currency: z.string().length(3).optional(),
    startsAt: z.string().datetime().optional(),
    expiresAt: z.string().datetime().optional(),
    maxRedemptions: z.number().int().positive().optional(),
    scope: z.enum(DISCOUNT_CODE_SCOPES).default("all"),
    offerIds: z.array(z.string().min(1)).default([]),
    active: z.boolean().default(true),
  })
  .refine((d) => d.type !== "fixed" || !!d.currency, {
    message: "currency is required when type is \"fixed\"",
    path: ["currency"],
  })
  .refine((d) => d.type !== "percentage" || d.value <= 100, {
    message: "a percentage discount cannot exceed 100",
    path: ["value"],
  });
export type CreateDiscountCodeInput = z.infer<typeof createDiscountCodeSchema>;

export const updateDiscountCodeSchema = z.object({
  startsAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  maxRedemptions: z.number().int().positive().optional(),
  active: z.boolean().optional(),
});
export type UpdateDiscountCodeInput = z.infer<typeof updateDiscountCodeSchema>;

export const listDiscountCodesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  active: z.coerce.boolean().optional(),
});
export type ListDiscountCodesQuery = z.infer<typeof listDiscountCodesQuerySchema>;
