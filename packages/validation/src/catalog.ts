import { z } from "zod";
import { OFFER_STATUSES, OFFER_TYPES } from "@korva/types";

/** The subset of StockMovementType a human can enter manually — "sold" is always automatic
 *  (order reservation), never a direct user action, so it's deliberately excluded here rather
 *  than filtered out of the shared STOCK_MOVEMENT_TYPES at runtime. */
const MANUAL_STOCK_MOVEMENT_TYPES = ["received", "returned", "damaged", "correction"] as const;

const customFieldsSchema = z.record(z.string(), z.unknown()).optional();

export const createCategorySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  attributeKeys: z.array(z.string().min(1).max(60)).max(50).optional(),
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
  barcode: z.string().max(64).optional(),
  priceOverride: z.number().nonnegative().optional(),
  stockOnHand: z.number().int().min(0).optional(),
});

export const bundleItemInputSchema = z.object({
  offerId: z.string().min(1),
  quantity: z.number().int().min(1),
});

/** Photos per offer. The first one is the main photo — the one storefront cards and the catalogue
 *  list show. Enforced here so the API refuses an 11th photo, not just the dashboard. */
export const OFFER_MAX_IMAGES = 10;

/** Bounds of Offer.durationMinutes. The upper bound is a working day, not a calendar day: a
 *  booking may not cross the organization's local midnight (isWithinWeeklyWindows). */
export const OFFER_MIN_DURATION_MINUTES = 5;
export const OFFER_MAX_DURATION_MINUTES = 720;

export const createOfferSchema = z.object({
  type: z.enum(OFFER_TYPES),
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  images: z.array(z.string().url()).max(OFFER_MAX_IMAGES).default([]),
  categories: z.array(z.string().min(1).max(80)).default([]),
  pricing: offerPricingSchema,
  sku: z.string().max(80).optional(),
  barcode: z.string().max(64).optional(),
  attributes: z.record(z.string(), z.string()).optional(),
  isBundle: z.boolean().default(false),
  bundleItems: z.array(bundleItemInputSchema).max(50).optional(),
  variants: z.array(offerVariantInputSchema).default([]),
  status: z.enum(OFFER_STATUSES).default("draft"),
  customFields: customFieldsSchema,
  trackStock: z.boolean().default(false),
  stockOnHand: z.number().int().min(0).optional(),
  lowStockThreshold: z.number().int().min(0).optional(),
  durationMinutes: z.number().int().min(OFFER_MIN_DURATION_MINUTES).max(OFFER_MAX_DURATION_MINUTES).optional(),
});
export type CreateOfferInput = z.infer<typeof createOfferSchema>;

export const updateOfferSchema = createOfferSchema.partial();
export type UpdateOfferInput = z.infer<typeof updateOfferSchema>;

export const adjustStockSchema = z.object({
  variantId: z.string().optional(),
  stockOnHand: z.number().int().min(0),
  /** Phase C2 (KORVA_OS_V2_AUDIT.md §2.4) — when given, sets THIS warehouse's own count to
   *  `stockOnHand` (not the offer's overall total) and adjusts the offer/variant aggregate by
   *  the resulting delta. Omitted (the default) keeps today's exact behavior: an absolute set
   *  of the aggregate itself, with no per-warehouse breakdown involved. */
  warehouseId: z.string().optional(),
});
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;

/** Delta-based, reason-tracked stock entry — distinct from adjustStockSchema's absolute "set to
 *  N" (a stocktake correction), this is the "logistics" side: receiving a supplier delivery,
 *  writing off damaged units, or a signed correction. Every entry becomes a StockMovement row,
 *  never just a silent stockOnHand mutation. */
export const recordStockMovementSchema = z
  .object({
    variantId: z.string().optional(),
    type: z.enum(MANUAL_STOCK_MOVEMENT_TYPES),
    quantity: z
      .number()
      .int()
      .refine((v) => v !== 0, "quantity must not be zero"),
    reason: z.string().max(500).optional(),
    /** Phase C2 — when given, this movement's delta also applies to this warehouse's own
     *  StockLevel row (created on first use), in addition to the offer/variant aggregate. */
    warehouseId: z.string().optional(),
    /** Phase C3 — only meaningful for `type: "received"`; feeds inventory valuation. */
    unitCost: z.number().nonnegative().optional(),
  })
  .refine((data) => data.type === "correction" || data.quantity > 0, {
    message: "quantity must be positive for received/returned/damaged",
    path: ["quantity"],
  });
export type RecordStockMovementInput = z.infer<typeof recordStockMovementSchema>;

export const listStockMovementsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  variantId: z.string().optional(),
});
export type ListStockMovementsQuery = z.infer<typeof listStockMovementsQuerySchema>;

export const OFFER_SORT_OPTIONS = ["newest", "price_asc", "price_desc"] as const;
export type OfferSort = (typeof OFFER_SORT_OPTIONS)[number];

export const listOffersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  type: z.enum(OFFER_TYPES).optional(),
  status: z.enum(OFFER_STATUSES).optional(),
  category: z.string().optional(),
  sort: z.enum(OFFER_SORT_OPTIONS).default("newest"),
});
export type ListOffersQuery = z.infer<typeof listOffersQuerySchema>;
