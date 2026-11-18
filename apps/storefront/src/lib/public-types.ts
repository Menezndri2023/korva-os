import type {
  BookingStatus,
  BusinessModel,
  DeliveryZone,
  FaqItem,
  FulfillmentMode,
  GalleryImage,
  LineItem,
  OfferOptionGroup,
  OfferPricing,
  OfferType,
  OfferVariant,
  OrderStatus,
  PaymentMethod,
  QuoteStatus,
  ReturnRequestStatus,
  StorefrontTheme,
  TeamMember,
  PublicReview,
  PublicReviewSummary,
  Testimonial,
} from "@korva/types";

/** Mirrors PublicService#getOrganization (apps/api/src/public/public.service.ts) exactly. */
export interface PublicOrganization {
  name: string;
  slug: string;
  type: string;
  /** Type of activity (business-models.ts); absent for an older organization. */
  businessModel?: BusinessModel;
  currency: string;
  language: string;
  logo?: string;
  /** Hex color (e.g. "#1a73e8") — the org's custom accent, applied per `storefrontTheme.customAccentApplied`. */
  brandColor?: string;
  tagline?: string;
  contactPhone?: string;
  /** International format, e.g. "+225 07 07 07 07 07" — see whatsappLink(). */
  whatsappNumber?: string;
  contactAddress?: string;
  heroImage?: string;
  enabledModules: string[];
  /** Which of "catalog"/"booking" to actually render — already intersected with enabledModules
   *  and the org's own storefrontSections choice server-side; render based on this, not
   *  enabledModules, for the offer grid and booking panel. */
  visibleSections: string[];
  /** Free-plan storefronts carry a "Propulsé par KORVA" mention. */
  poweredByKorva?: boolean;
  /** Whether a visitor can CREATE a customer account here; signing in is never taken away. */
  customerAccountsEnabled?: boolean;
  /** Whether the site offers "Se connecter": accounts can be created, or some already exist. */
  customerSignInAvailable?: boolean;
  /** Flat shipping rate charged at checkout — undefined means no shipping cost. */
  shippingFlatRate?: number;
  /** Mirrors Organization's fulfillment settings. `fulfillmentModes` undefined means the shop
   *  never configured them: the flat rate applies to every order, as before. */
  fulfillmentModes?: FulfillmentMode[];
  deliveryZones?: DeliveryZone[];
  pickupInstructions?: string;
  orderLeadTimeMinutes?: number;
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
  /** The announcement band at the top of the site — only sent on Starter and above. */
  announcement?: string;
  /** Slideshow photos after heroImage — only sent on Business. */
  heroSlides?: string[];
  /** Tracking ids — only sent on Pro and above; loaded after the visitor's consent. */
  tracking?: { googleAnalyticsId?: string; metaPixelId?: string };
  testimonials?: Testimonial[];
  /** Real customers' reviews — every plan. Absent from an API older than this field. */
  reviewSummary?: PublicReviewSummary;
  teamMembers?: TeamMember[];
  galleryImages?: GalleryImage[];
  faqItems?: FaqItem[];
  /** Org-configurable SEO override, every plan tier — undefined means "use the auto-derived
   *  title/description" (see [slug]/page.tsx's generateMetadata). */
  seoTitle?: string;
  seoDescription?: string;
}

/** Mirrors PublicSitesController#listSitemapEntries exactly. */
export interface PublicSitemapEntry {
  slug: string;
  updatedAt: string;
  /** Catalogue module on: the site has a /catalogue page and offer pages. */
  catalog?: boolean;
  /** Active offers, newest first (capped per site by the API). */
  offers?: { id: string; updatedAt: string }[];
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
  /** Fixed length of one booking, set by the business — see Offer.durationMinutes. */
  durationMinutes?: number;
  /** Price before a promotion, always higher than pricing.amount — see Offer.compareAtPrice. */
  compareAtPrice?: number;
  /** The customer chooses the amount (a donation); pricing.amount is the minimum — see
   *  Offer.freeAmount. */
  freeAmount?: boolean;
  /** « Coup de cœur » — only sent on Pro and above. */
  featured?: boolean;
  /** Characteristics set by the business (matière, origine, équipements...) — Offer.attributes. */
  attributes?: Record<string, string>;
  /** "night" for a stay booked from an arrival to a departure date — see Offer.bookingUnit. */
  bookingUnit?: "slot" | "night";
  minNights?: number;
  /** Share of the price paid online when booking — see Offer.depositPercent. */
  depositPercent?: number;
  /** Free cancellation by the customer up to this many hours before — see Offer.cancellationHours. */
  cancellationHours?: number;
  /** Choices made when ordering (cuisson, taille, suppléments) — see OfferOptionGroup. */
  optionGroups?: OfferOptionGroup[];
}

/** Mirrors PublicService#getOfferReviews exactly. */
export interface PublicOfferReviewSummary {
  average: number | null;
  count: number;
  reviews: PublicReview[];
}

/** Mirrors PublicService#listResources exactly. */
export interface PublicResource {
  id: string;
  name: string;
  /** "person", "room", "equipment", or an older free-text value — see RESOURCE_KINDS. */
  type: string;
  capacity?: number;
  description?: string;
  photo?: string;
  /** Seats at a restaurant table — see Resource.seats. */
  seats?: number;
}

/** Mirrors PublicService#getSlots exactly. `time` is the slot's start as read on the business's
 *  own wall clock, computed by the API — the storefront never converts timezones itself. */
export interface PublicSlots {
  date: string;
  durationMinutes: number;
  slots: { startAt: string; endAt: string; time: string }[];
}

/** Mirrors PublicService#getStayQuote exactly. */
export interface PublicStayQuote {
  nights: number;
  pricePerNight: number;
  total: number;
  currency: string;
  minNights: number | null;
  available: boolean;
  /** Why it is not available: STAY_TOO_SHORT, STAY_BELOW_MINIMUM, SLOT_UNAVAILABLE, SLOT_BLOCKED... */
  reason: string | null;
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
  /** Chosen OfferOption ids. Part of the line's identity: a large and a small garba are two
   *  lines. The API re-checks and re-prices them; `unitPrice` here is only for display. */
  optionIds?: string[];
  name: string;
  unitPrice: number;
  /** The amount the customer chose, on a free-amount offer only (a donation). Part of the
   *  line's identity, and the one amount the API takes from the client — within the minimum. */
  amount?: number;
  quantity: number;
}

/** Mirrors PublicService#trackOrder exactly. */
export interface TrackedOrder {
  number: string;
  status: OrderStatus;
  /** The order's online payment, checked live with GeniusPay; null when paid otherwise. */
  payment?: { status: "paid" | "pending" | "failed" } | null;
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
  /** The deposit asked online when booking (Offer.depositPercent), checked live. */
  deposit?: { amount: number; status: "paid" | "pending" | "failed" };
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
  cancelledBy?: "customer" | "business";
  /** The offer's free cancellation window, in hours before the start. */
  cancellationHours?: number;
  /** Set only while the customer may still cancel it themselves. */
  cancellableUntil?: string;
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
