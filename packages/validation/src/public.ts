import { z } from "zod";
import { FULFILLMENT_MODES, OFFER_TYPES } from "@korva/types";
import { OFFER_SORT_OPTIONS } from "./catalog.ts";

export const publicContactSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(120).optional(),
  lastName: z.string().min(1).max(120).optional(),
  phone: z.string().min(1).max(40).optional(),
});

export const listPublicOffersQuerySchema = z.object({
  type: z.enum(OFFER_TYPES).optional(),
});
export type ListPublicOffersQuery = z.infer<typeof listPublicOffersQuerySchema>;

/** Backs the dedicated `/[slug]/catalogue` storefront page — distinct from
 *  listPublicOffersQuerySchema above, which stays a small, unpaginated preview used by the
 *  homepage templates and generateMetadata. limit is capped lower than the internal
 *  listOffersQuerySchema (100): a public visitor never needs more than a couple of screens per
 *  page, and a lower cap keeps a single request cheap on an unauthenticated, unthrottled-by-tier
 *  route. */
export const searchPublicOffersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(24),
  type: z.enum(OFFER_TYPES).optional(),
  category: z.string().optional(),
  search: z.string().min(1).max(200).optional(),
  sort: z.enum(OFFER_SORT_OPTIONS).default("newest"),
});
export type SearchPublicOffersQuery = z.infer<
  typeof searchPublicOffersQuerySchema
>;

export const publicAvailabilityQuerySchema = z.object({
  resourceId: z.string().min(1),
  date: z.string().min(1),
});
export type PublicAvailabilityQuery = z.infer<typeof publicAvailabilityQuerySchema>;

/**
 * GET /public/:slug/slots. `durationMinutes` is only read for an offer that has no duration of
 * its own (Offer.durationMinutes): an offer's fixed duration always wins, so a customer cannot
 * book a shorter "Coupe femme" than the salon set.
 */
export const publicSlotsQuerySchema = z.object({
  resourceId: z.string().min(1),
  offerId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
  durationMinutes: z.coerce.number().int().min(15).max(480).optional(),
});
export type PublicSlotsQuery = z.infer<typeof publicSlotsQuerySchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

/**
 * A public booking is either a time slot (startAt/endAt, from GET /slots) or a STAY for a
 * per-night offer (checkIn/checkOut dates — the API applies the organization's check-in and
 * check-out times in its timezone). Which one is required depends on the offer, which only the
 * API knows; this schema only requires one complete pair.
 */
export const createPublicBookingSchema = z
  .object({
    /** Omitted for a TABLE booking: the API picks the table from partySize. */
    resourceId: z.string().min(1).optional(),
    partySize: z.number().int().min(1).max(100).optional(),
    offerId: z.string().min(1),
    startAt: z.string().datetime().optional(),
    endAt: z.string().datetime().optional(),
    checkIn: isoDate.optional(),
    checkOut: isoDate.optional(),
    notes: z.string().max(2000).optional(),
    contact: publicContactSchema,
  })
  .refine((b) => (b.startAt && b.endAt) || (b.checkIn && b.checkOut), {
    message: "Either startAt/endAt or checkIn/checkOut is required",
  })
  .refine((b) => b.resourceId || b.partySize, {
    message: "Either resourceId or partySize is required",
  });

/** GET /public/:slug/table-slots — start times when at least one table seats the party. */
export const publicTableSlotsSchema = z.object({
  offerId: z.string().min(1),
  date: isoDate,
  partySize: z.coerce.number().int().min(1).max(100),
});
export type PublicTableSlotsQuery = z.infer<typeof publicTableSlotsSchema>;

/** GET /public/:slug/stay-quote — nights, total and availability of one room for a stay. */
export const publicStayQuoteSchema = z.object({
  offerId: z.string().min(1),
  resourceId: z.string().min(1),
  checkIn: isoDate,
  checkOut: isoDate,
});
export type PublicStayQuoteQuery = z.infer<typeof publicStayQuoteSchema>;
export type CreatePublicBookingInput = z.infer<typeof createPublicBookingSchema>;

const publicOrderLineItemSchema = z.object({
  offerId: z.string().min(1),
  variantId: z.string().min(1).optional(),
  /** Ids of the chosen OfferOptions. Checked and priced by the API against the stored offer. */
  optionIds: z.array(z.string().min(1).max(64)).max(50).optional(),
  quantity: z.number().positive(),
});
// All fields optional at this layer, even though a "complete" address needs all four — a
// storefront checkout form always submits its shippingAddress object once any field is
// registered (react-hook-form mounts every registered path as "" by default), so requiring
// fields here would block checkout entirely for a shopper who left the whole (optional) address
// section untouched. PublicService#createOrder is what decides whether the submitted address is
// actually complete enough to persist — an incomplete one is silently dropped, not rejected.
export const publicShippingAddressSchema = z.object({
  line1: z.string().max(200).optional(),
  line2: z.string().max(200).optional(),
  city: z.string().max(120).optional(),
  postalCode: z.string().max(20).optional(),
  country: z.string().max(120).optional(),
});
export type PublicShippingAddressInput = z.infer<
  typeof publicShippingAddressSchema
>;
export const createPublicOrderSchema = z.object({
  items: z.array(publicOrderLineItemSchema).min(1),
  currency: z.string().length(3),
  notes: z.string().max(2000).optional(),
  contact: publicContactSchema,
  discountCode: z.string().max(40).optional(),
  /** Pays the order (up to the card's balance) with a gift card's code. */
  giftCardCode: z.string().trim().max(40).optional(),
  shippingAddress: publicShippingAddressSchema.optional(),
  /** Required by the API when the organization offers fulfillment modes; ignored otherwise. */
  fulfillmentMode: z.enum(FULFILLMENT_MODES).optional(),
  deliveryZoneId: z.string().min(1).max(64).optional(),
  /** Wall-clock date and time in the BUSINESS's timezone, converted by the API — never an ISO
   *  instant built in the browser, which is how the booking form once shifted 14:00 to 16:00. */
  requestedFor: z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
      time: z.string().regex(/^\d{2}:\d{2}$/, "expected HH:mm"),
    })
    .optional(),
  tableLabel: z.string().max(40).optional(),
});
export type CreatePublicOrderInput = z.infer<typeof createPublicOrderSchema>;

/**
 * Backs the embeddable widget (apps/storefront/public/korva-widget.js) and any other external
 * site's own "contact us" / lead-capture form — see createPublicBookingSchema/
 * createPublicOrderSchema above for the identical contact-capture convention this reuses.
 */
export const createPublicLeadSchema = z.object({
  message: z.string().min(1).max(2000),
  source: z.string().min(1).max(100).optional(),
  contact: publicContactSchema,
});

/**
 * Fired once an email is known during checkout (see the storefront's CheckoutPanel), before the
 * real order exists — the only point at which an otherwise-anonymous, localStorage-only
 * storefront cart becomes attributable to a real contact, which is what makes abandoned-cart
 * recovery possible at all. Best-effort/fire-and-forget on the frontend; never blocks checkout.
 */
export const trackCartCheckoutStartedSchema = z.object({
  contact: publicContactSchema,
  items: z.array(publicOrderLineItemSchema.omit({ variantId: true })).min(1),
});
export type TrackCartCheckoutStartedInput = z.infer<
  typeof trackCartCheckoutStartedSchema
>;
export type CreatePublicLeadInput = z.infer<typeof createPublicLeadSchema>;

/**
 * Query for the customer-facing order/booking lookup endpoints. `email` is the ONLY proof of
 * ownership accepted — never the order number / booking id alone (that would let an attacker
 * enumerate valid order numbers by trying them without any credential). See PublicService#trackOrder
 * and #trackBooking for the matching generic-404 behavior on any mismatch.
 */
export const trackByEmailQuerySchema = z.object({
  email: z.string().email(),
});
export type TrackByEmailQuery = z.infer<typeof trackByEmailQuerySchema>;

/** Phase E3 — apps/storefront's custom-domain middleware sends the request's own `Host` header
 *  verbatim; deliberately permissive (just non-empty) since an unrecognized/malformed hostname
 *  must resolve to "not found," never a 400 that would break the visitor's page load. */
export const resolveDomainQuerySchema = z.object({
  host: z.string().min(1).max(253),
});
export type ResolveDomainQuery = z.infer<typeof resolveDomainQuerySchema>;

/** Caddy's on-demand-TLS `ask` endpoint is called with `?domain=<host>` — a fixed query-parameter
 *  name set by Caddy, which is why this exists separately from resolveDomainQuerySchema's `host`
 *  rather than reusing it. Same validation otherwise (253 = maximum DNS name length). */
export const domainAllowedQuerySchema = z.object({
  domain: z.string().min(1).max(253),
});
export type DomainAllowedQuery = z.infer<typeof domainAllowedQuerySchema>;

/** One basket line as the storefront keeps it (use-cart.ts) — prices are re-read at order time. */
const customerBasketLineSchema = z.object({
  offerId: z.string().min(1).max(64),
  variantId: z.string().max(64).optional(),
  optionIds: z.array(z.string().max(64)).max(20).optional(),
  name: z.string().max(300),
  unitPrice: z.number().min(0),
  quantity: z.number().int().min(1).max(99),
});

/** PUT /public/:slug/account/basket — the whole basket and the lines put aside. */
export const customerBasketSchema = z.object({
  cart: z.array(customerBasketLineSchema).max(50),
  saved: z.array(customerBasketLineSchema).max(50),
});
export type CustomerBasketInput = z.infer<typeof customerBasketSchema>;
