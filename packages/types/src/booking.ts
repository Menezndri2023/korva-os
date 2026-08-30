/**
 * Not a closed enum on purpose — a Resource can be a person, vehicle, room,
 * hall, equipment, boat, land, material, space, or anything else an
 * organization needs to schedule. Never add sector-specific resource types.
 */
export interface WeeklyAvailabilityWindow {
  /** 0 = Sunday ... 6 = Saturday */
  dayOfWeek: number;
  /** "HH:mm", 24h, in the organization's timezone */
  startTime: string;
  endTime: string;
}

export interface BlockedSlot {
  id: string;
  startAt: string;
  endAt: string;
  reason?: string;
  source?: "external_calendar";
}

export interface Resource {
  id: string;
  organizationId: string;
  name: string;
  type: string;
  capacity: number;
  description?: string;
  active: boolean;
  weeklyAvailability: WeeklyAvailabilityWindow[];
  blockedSlots: BlockedSlot[];
  externalCalendarUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export const BOOKING_STATUSES = ["pending", "confirmed", "cancelled", "completed"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_PAYMENT_STATUSES = ["unpaid", "deposit_paid", "paid"] as const;
export type BookingPaymentStatus = (typeof BOOKING_PAYMENT_STATUSES)[number];

export interface BookingPricing {
  amount: number;
  currency: string;
}

export interface Booking {
  id: string;
  organizationId: string;
  resourceId: string;
  offerId: string;
  contactId: string;
  startAt: string;
  endAt: string;
  status: BookingStatus;
  pricing: BookingPricing;
  paymentStatus: BookingPaymentStatus;
  notes?: string;
  /** Set once BookingReminderSchedulerService has sent a reminder for this appointment — absent
   *  otherwise. Cleared on reschedule (the old reminder no longer applies to the new time). */
  reminderSentAt?: string;
  /** Set when this booking is completed (status becomes 'completed') — whether this specific
   *  contact actually showed up. Orthogonal to `status`: a group session has many Bookings
   *  sharing one resource+time, and some attendees may be absent while the session still
   *  happened. Absent (undefined) until completed. */
  attended?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DayAvailability {
  date: string;
  windows: { startTime: string; endTime: string }[];
  blockedSlots: BlockedSlot[];
  bookings: { startAt: string; endAt: string }[];
  capacity: number;
}
