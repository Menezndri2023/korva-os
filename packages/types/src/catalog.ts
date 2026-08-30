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
   *  not at fulfillment — see InventoryService for the concurrency reasoning. */
  stockOnHand?: number;
  createdAt: string;
  updatedAt: string;
}
