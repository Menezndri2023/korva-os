export type BusinessGraphEntryType =
  | "lead"
  | "quote"
  | "invoice"
  | "payment"
  | "booking"
  | "order"
  | "conversation"
  | "task";

/** One event in a contact's cross-module history — the smallest unit of the "Business Graph"
 *  read layer. Each entry projects an existing document from CRM/Finance/Booking/Commerce/
 *  Communication; nothing here is stored independently, so this type has no id of its own
 *  beyond the source document's id. */
export interface BusinessGraphTimelineEntry {
  type: BusinessGraphEntryType;
  id: string;
  occurredAt: string;
  status: string;
  summary: string;
  amount?: number;
  currency?: string;
}

export interface ContactTimeline {
  contactId: string;
  entries: BusinessGraphTimelineEntry[];
}
