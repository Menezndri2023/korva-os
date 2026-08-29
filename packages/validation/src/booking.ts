import { z } from "zod";
import { BOOKING_STATUSES } from "@korva/types";

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

export const weeklyAvailabilityWindowInputSchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: z.string().regex(timeRegex, "expected HH:mm"),
    endTime: z.string().regex(timeRegex, "expected HH:mm"),
  })
  .refine((w) => w.startTime < w.endTime, { message: "startTime must be before endTime" });

export const createResourceSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.string().min(1).max(60),
  capacity: z.number().int().positive().default(1),
  description: z.string().max(2000).optional(),
  active: z.boolean().default(true),
  weeklyAvailability: z.array(weeklyAvailabilityWindowInputSchema).default([]),
  /** ICS feed URL (e.g. a Google/Outlook/Apple Calendar "secret address") — see
   *  apps/api/src/booking/resources/schemas/resource.schema.ts for the full rationale. */
  externalCalendarUrl: z.string().url().max(2000).optional(),
});
export type CreateResourceInput = z.infer<typeof createResourceSchema>;

export const updateResourceSchema = createResourceSchema.partial();
export type UpdateResourceInput = z.infer<typeof updateResourceSchema>;

export const addBlockedSlotSchema = z
  .object({
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    reason: z.string().max(300).optional(),
  })
  .refine((b) => b.startAt < b.endAt, { message: "startAt must be before endAt" });
export type AddBlockedSlotInput = z.infer<typeof addBlockedSlotSchema>;

export const availabilityQuerySchema = z.object({
  resourceId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
});
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

export const createBookingSchema = z
  .object({
    resourceId: z.string().min(1),
    offerId: z.string().min(1),
    contactId: z.string().min(1),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    notes: z.string().max(2000).optional(),
  })
  .refine((b) => b.startAt < b.endAt, { message: "startAt must be before endAt" });
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const rescheduleBookingSchema = z
  .object({
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
  })
  .refine((b) => b.startAt < b.endAt, { message: "startAt must be before endAt" });
export type RescheduleBookingInput = z.infer<typeof rescheduleBookingSchema>;

export const updateBookingSchema = z.object({
  notes: z.string().max(2000).optional(),
});
export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;

export const listBookingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  resourceId: z.string().optional(),
  status: z.enum(BOOKING_STATUSES).optional(),
  contactId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type ListBookingsQuery = z.infer<typeof listBookingsQuerySchema>;
