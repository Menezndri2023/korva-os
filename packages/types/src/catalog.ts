import type { CustomFieldValues } from "./custom-fields.ts";

export const OFFER_TYPES = [
  "product",
  "service",
  "booking",
  "digital_product",
  "subscription",
  "package",
] as const;
export type OfferType = (typeof OFFER_TYPES)[number];

export const OFFER_STATUSES = ["draft", "active", "archived"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export interface OfferPricing {
  amount: number;
  currency: string;
  taxRate?: number;
}

export interface OfferVariant {
  id: string;
  name: string;
  sku?: string;
  priceOverride?: number;
  /** Only meaningful when the parent Offer.trackStock is true. Independent from the parent
   *  offer's own stockOnHand — a variant-tracked offer's stock lives entirely here, per variant
   *  (e.g. size M and size L of the same shirt sell out independently), not on the offer. */
  stockOnHand?: number;
}

export interface Category {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Offer {
  id: string;
  organizationId: string;
  type: OfferType;
  name: string;
  description?: string;
  images: string[];
  categories: string[];
  pricing: OfferPricing;
  sku?: string;
  variants: OfferVariant[];
  status: OfferStatus;
  customFields: CustomFieldValues;
  /** Opt-in stock tracking — false (default) means this offer is never checked/decremented by
   *  order creation, matching every existing offer's behavior today. */
  trackStock: boolean;
  /** Only meaningful when trackStock is true. Reserved (decremented) at order-creation time,
   *  not at fulfillment — see InventoryService for the concurrency reasoning. Ignored (stock
   *  lives on each entry of `variants` instead) once this offer actually has variants. */
  stockOnHand?: number;
  /** Reorder point — an alert-worthy "getting low" level, distinct from stockOnHand hitting
   *  exactly 0 (which always alerts regardless of this field). Unset means no low-stock alert
   *  beyond the zero case. Applies per-variant when the offer has variants. */
  lowStockThreshold?: number;
  createdAt: string;
  updatedAt: string;
}

export const STOCK_MOVEMENT_TYPES = [
  "received",
  "sold",
  "returned",
  "damaged",
  "correction",
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export interface StockMovement {
  id: string;
  organizationId: string;
  offerId: string;
  variantId?: string;
  type: StockMovementType;
  /** Signed — positive adds to stock, negative removes. */
  quantity: number;
  /** stockOnHand (offer- or variant-level, whichever this movement applies to) immediately
   *  after this movement was applied — lets the ledger be read without replaying every prior
   *  movement to know the running total at any point in time. */
  stockAfter: number;
  reason?: string;
  /** Set for automatic movements (sold/returned) tied to a real order; unset for manual entries
   *  (received/damaged/correction). */
  referenceType?: "order";
  referenceId?: string;
  userId?: string;
  createdAt: string;
}
