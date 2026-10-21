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

/**
 * The usual kinds of bookable resource, offered as a choice in the dashboard. `Resource.type`
 * stays a free string (never a closed enum — see the note above), so older values keep working;
 * these are just the ones the product now speaks in.
 *
 * "person" is the one that matters most: a bookable member of the team (a hairdresser, a coach)
 * who needs NO dashboard account and therefore uses no seat. Seats are for people who log in.
 */
export const RESOURCE_KINDS = ["person", "room", "equipment"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const RESOURCE_KIND_LABELS: Record<ResourceKind, string> = {
  person: "Membre de l'équipe",
  room: "Lieu (salle, cabine, table, chambre)",
  equipment: "Équipement",
};

export interface Resource {
  id: string;
  organizationId: string;
  name: string;
  type: string;
  capacity: number;
  description?: string;
  /** Shown to customers choosing whom to book — mostly for a "person" resource. */
  photo?: string;
  /** Seats at a restaurant table. Set on every bookable resource of an organization, it turns
   *  the storefront into table booking: the customer gives a party size and the API assigns
   *  the smallest free table that fits. Unrelated to `capacity` (bookings at the same time). */
  seats?: number;
  active: boolean;
  weeklyAvailability: WeeklyAvailabilityWindow[];
  blockedSlots: BlockedSlot[];
  externalCalendarUrl?: string;
  /** Optional link to a staff Membership — see Booking.staffMembershipId for the snapshot
   *  rationale on the booking side. */
  membershipId?: string;
  createdAt: string;
  updatedAt: string;
}

/** Arrival and departure times of a stay when the organization has not set its own. */
export const DEFAULT_CHECK_IN_TIME = "15:00";
export const DEFAULT_CHECK_OUT_TIME = "11:00";

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
  /** Set on a stay (per-night offer): how many nights `pricing.amount` covers. */
  nights?: number;
  /** Party size of a table booking. */
  partySize?: number;
  notes?: string;
  /** Set once BookingReminderSchedulerService has sent a reminder for this appointment — absent
   *  otherwise. Cleared on reschedule (the old reminder no longer applies to the new time). */
  reminderSentAt?: string;
  /** Set when this booking is completed (status becomes 'completed') — whether this specific
   *  contact actually showed up. Orthogonal to `status`: a group session has many Bookings
   *  sharing one resource+time, and some attendees may be absent while the session still
   *  happened. Absent (undefined) until completed. */
  attended?: boolean;
  /** Snapshot of the resource's assigned staff member at booking-creation time — see the schema
   *  field's own doc comment for why this is a snapshot, not a live join. */
  staffMembershipId?: string;
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

export const WAITLIST_ENTRY_STATUSES = ["waiting", "notified", "cancelled"] as const;
export type WaitlistEntryStatus = (typeof WAITLIST_ENTRY_STATUSES)[number];

export interface WaitlistEntry {
  id: string;
  organizationId: string;
  resourceId: string;
  offerId: string;
  contactId: string;
  startAt: string;
  endAt: string;
  status: WaitlistEntryStatus;
  notifiedAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/** Tracks a contact's remaining sessions against a `package`-type Offer (e.g. a 10-session
 *  massage pass). Topped up when a package is sold, decremented when a Booking for that same
 *  offer is completed with `attended: true` — see CreditBalancesService. One balance per
 *  (organizationId, contactId, offerId) triple; buying another pack adds to it rather than
 *  creating a second row. */
export interface CreditBalance {
  id: string;
  organizationId: string;
  contactId: string;
  offerId: string;
  totalCredits: number;
  remainingCredits: number;
  createdAt: string;
  updatedAt: string;
}
