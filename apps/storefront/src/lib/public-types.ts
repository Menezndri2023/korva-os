import type {
  BookingStatus,
  FaqItem,
  GalleryImage,
  LineItem,
  OfferPricing,
  OfferType,
  OfferVariant,
  OrderStatus,
  PaymentMethod,
  QuoteStatus,
  ReturnRequestStatus,
  StorefrontTheme,
  TeamMember,
  Testimonial,
} from "@korva/types";

/** Mirrors PublicService#getOrganization (apps/api/src/public/public.service.ts) exactly. */
export interface PublicOrganization {
  name: string;
  slug: string;
  type: string;
  currency: string;
  language: string;
  logo?: string;
  /** Hex color (e.g. "#1a73e8") — the org's custom accent, applied per `storefrontTheme.customAccentApplied`. */
  brandColor?: string;
  tagline?: string;
  heroImage?: string;
  enabledModules: string[];
  /** Which of "catalog"/"booking" to actually render — already intersected with enabledModules
   *  and the org's own storefrontSections choice server-side; render based on this, not
   *  enabledModules, for the offer grid and booking panel. */
  visibleSections: string[];
  /** Flat shipping rate charged at checkout — undefined means no shipping cost. */
  shippingFlatRate?: number;
  /** Resolved storefront visual template/palette/font-pairing — already clamped to the org's
   *  plan server-side. See @/app/[slug]/storefront-client.tsx's `renderTemplate`. */
  storefrontTheme: StorefrontTheme;
  /** Already resolved to what's actually usable — "online" is only ever present when a real PSP
   *  is connected. Never empty. */
  acceptedPaymentMethods: PaymentMethod[];
  /** Content sections (Pro plan and above) — already clamped to the org's current plan
   *  server-side, so undefined/empty here always means "don't render," never "check the plan
   *  yourself." See apps/storefront/src/templates/sections/. */
  aboutText?: string;
  testimonials?: Testimonial[];
  teamMembers?: TeamMember[];
  galleryImages?: GalleryImage[];
  faqItems?: FaqItem[];
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

/** Mirrors PublicService#getOfferReviews exactly. */
export interface PublicOfferReviewSummary {
  average: number | null;
  count: number;
  reviews: { rating: number; comment?: string; createdAt: string }[];
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
  variantId?: string;
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

/** Mirrors CustomerAuthService's toPublicCustomer shape exactly. */
export interface CustomerProfile {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}

export interface CustomerAuthResponse {
  accessToken: string;
  refreshToken: string;
  customer: CustomerProfile;
}

/** Mirrors CustomerAuthService#listOrders' mapped item shape. */
export interface CustomerOrderSummary {
  id: string;
  number: string;
  status: OrderStatus;
  total: number;
  currency: string;
  createdAt: string;
}

/** Mirrors CustomerAuthService#listBookings' mapped item shape. */
export interface CustomerBookingSummary {
  id: string;
  status: BookingStatus;
  startAt: string;
  endAt: string;
  pricing: { amount: number; currency: string };
}

/** Mirrors CustomerAuthService#getOrderDetail's shape exactly. */
export interface CustomerOrderDetail {
  id: string;
  number: string;
  status: OrderStatus;
  items: LineItem[];
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  shippingCost: number;
  shippingAddress?: { line1: string; line2?: string; city: string; postalCode: string; country: string };
  total: number;
  currency: string;
  hasInvoice: boolean;
  createdAt: string;
}

/** Mirrors CustomerAuthService#listReturnRequests' mapped item shape. */
export interface CustomerReturnRequestSummary {
  id: string;
  orderId: string;
  status: ReturnRequestStatus;
  reason: string;
  refundAmount: number;
  currency: string;
  createdAt: string;
}

/** Mirrors WishlistService#list's mapped item shape. */
export interface CustomerWishlistEntry {
  id: string;
  offerId: string;
  offerName: string;
  offerImage?: string;
  pricing: { amount: number; currency: string };
  createdAt: string;
}

/** Mirrors CustomerAuthService#getBookingDetail's shape exactly. */
export interface CustomerBookingDetail {
  id: string;
  status: BookingStatus;
  startAt: string;
  endAt: string;
  pricing: { amount: number; currency: string };
  attended?: boolean;
  notes?: string;
  offerName: string;
}

/** Mirrors CustomerAuthService#listQuotes' mapped item shape. */
export interface CustomerQuoteSummary {
  id: string;
  number: string;
  status: QuoteStatus;
  total: number;
  currency: string;
  validUntil?: string;
  createdAt: string;
}

/** Mirrors CustomerAuthService#getQuoteDetail's shape exactly. */
export interface CustomerQuoteDetail {
  id: string;
  number: string;
  status: QuoteStatus;
  items: LineItem[];
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  total: number;
  currency: string;
  validUntil?: string;
  notes?: string;
  signedByName?: string;
  signedAt?: string;
}
