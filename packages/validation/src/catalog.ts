import { z } from "zod";
import { OFFER_STATUSES, OFFER_TYPES } from "@korva/types";

const customFieldsSchema = z.record(z.string(), z.unknown()).optional();

export const createCategorySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = createCategorySchema.partial();
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

export const offerPricingSchema = z.object({
  amount: z.number().nonnegative(),
  currency: z.string().length(3),
  taxRate: z.number().min(0).max(100).optional(),
});

export const offerVariantInputSchema = z.object({
  name: z.string().min(1).max(120),
  sku: z.string().max(80).optional(),
  priceOverride: z.number().nonnegative().optional(),
});

export const createOfferSchema = z.object({
  type: z.enum(OFFER_TYPES),
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  images: z.array(z.string().url()).default([]),
  categories: z.array(z.string().min(1).max(80)).default([]),
  pricing: offerPricingSchema,
  sku: z.string().max(80).optional(),
  variants: z.array(offerVariantInputSchema).default([]),
  status: z.enum(OFFER_STATUSES).default("draft"),
  customFields: customFieldsSchema,
});
export type CreateOfferInput = z.infer<typeof createOfferSchema>;

export const updateOfferSchema = createOfferSchema.partial();
export type UpdateOfferInput = z.infer<typeof updateOfferSchema>;

export const listOffersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  type: z.enum(OFFER_TYPES).optional(),
  status: z.enum(OFFER_STATUSES).optional(),
  category: z.string().optional(),
});
export type ListOffersQuery = z.infer<typeof listOffersQuerySchema>;
