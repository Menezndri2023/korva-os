import type {
  BookingStatus,
  OfferPricing,
  OfferType,
  OfferVariant,
  OrderStatus,
} from "@korva/types";

/** Mirrors PublicService#getOrganization (apps/api/src/public/public.service.ts) exactly. */
export interface PublicOrganization {
  name: string;
  slug: string;
  type: string;
  currency: string;
  language: string;
  logo?: string;
  /** Hex color (e.g. "#1a73e8") — a single storefront accent, not a full theme. */
  brandColor?: string;
  enabledModules: string[];
}

/**
 * Mirrors PublicService#listOffers exactly, including `variants` — the backend has always sent
 * this field on GET /public/:slug/offers, it was just missing from the storefront's hand-rolled
 * type until now (Wave 2 Agent F).
 */
export interface PublicOffer {
  id: string;
  type: OfferType;
  name: string;
  description?: string;
  images: string[];
  categories: string[];
  pricing: OfferPricing;
  variants: OfferVariant[];
}

/** Mirrors PublicService#listResources exactly. */
export interface PublicResource {
  id: string;
  name: string;
  type: string;
  capacity?: number;
}

/** Mirrors PublicService#getAvailability exactly. */
export interface PublicAvailability {
  date: string;
  windows: { startTime: string; endTime: string }[];
  bookings: { startAt: string; endAt: string }[];
  blockedSlots: { startAt: string; endAt: string }[];
}

export interface ContactFormValues {
  firstName: string;
  email: string;
  phone: string;
}

export interface CartLine {
  offerId: string;
  name: string;
  unitPrice: number;
  quantity: number;
}

/** Mirrors PublicService#trackOrder exactly. */
export interface TrackedOrder {
  number: string;
  status: OrderStatus;
  items: { description: string; quantity: number; unitPrice: number }[];
  total: number;
  currency: string;
}

/** Mirrors PublicService#trackBooking exactly. */
export interface TrackedBooking {
  id: string;
  status: BookingStatus;
  startAt: string;
  endAt: string;
  pricing: { amount: number; currency: string };
}
