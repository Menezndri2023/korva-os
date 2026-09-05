import { z } from "zod";
import { OFFER_TYPES } from "@korva/types";
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

export const createPublicBookingSchema = z.object({
  resourceId: z.string().min(1),
  offerId: z.string().min(1),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  notes: z.string().max(2000).optional(),
  contact: publicContactSchema,
});
export type CreatePublicBookingInput = z.infer<typeof createPublicBookingSchema>;

const publicOrderLineItemSchema = z.object({
  offerId: z.string().min(1),
  variantId: z.string().min(1).optional(),
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
  shippingAddress: publicShippingAddressSchema.optional(),
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
