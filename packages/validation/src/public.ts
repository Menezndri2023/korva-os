import { z } from "zod";
import { OFFER_TYPES } from "@korva/types";

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
  quantity: z.number().positive(),
});
export const createPublicOrderSchema = z.object({
  items: z.array(publicOrderLineItemSchema).min(1),
  currency: z.string().length(3),
  notes: z.string().max(2000).optional(),
  contact: publicContactSchema,
});
export type CreatePublicOrderInput = z.infer<typeof createPublicOrderSchema>;

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
