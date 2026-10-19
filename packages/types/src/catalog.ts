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
  /** EAN/UPC — distinct from `sku` (an internal reference), a variant's own retail barcode. */
  barcode?: string;
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
  /** Suggested attribute keys for offers filed under this category (e.g. ["couleur","taille"]
   *  for "Vêtements") — a hint for the catalog UI, never enforced/validated against Offer.attributes. */
  attributeKeys?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface BundleItem {
  offerId: string;
  quantity: number;
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
  /** EAN/UPC for offers with no variants — see OfferVariant.barcode for the per-variant version. */
  barcode?: string;
  /** Free-form key-value product attributes (e.g. {"couleur":"rouge","taille":"M"}) — distinct
   *  from `customFields`, which is org-defined and validated; attributes are unvalidated, ad-hoc
   *  descriptors an offer can carry without any setup. */
  attributes?: Record<string, string>;
  /** A bundle/kit is a real Offer in its own right that also lists the offers it's composed of —
   *  purely descriptive today, no cascading stock deduction from a bundle sale onto its
   *  component offers (see docs/KORVA_OS_V2_AUDIT.md §2.4). */
  isBundle: boolean;
  bundleItems?: BundleItem[];
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
  /** How long one booking of this offer lasts. Set by the business, never chosen by its customer:
   *  when present, the storefront offers ready-made slots of exactly this length and the API
   *  computes a public booking's end from it. Unset keeps the older behaviour (the booking form
   *  asks for a duration). Only meaningful for `booking` offers. */
  durationMinutes?: number;
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
  /** Only ever set on a `received` movement — the real per-unit cost, when known. See Phase C3
   *  inventory valuation, which reads each offer's most recent costed `received` movement. */
  unitCost?: number;
  createdAt: string;
}
