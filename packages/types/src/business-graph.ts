export type BusinessGraphEntryType =
  | "lead"
  | "deal"
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

/**
 * Phase F1 (docs/KORVA_OS_V2_AUDIT.md §2.7) — the Business Graph's second read surface,
 * org-level rather than single-contact-anchored. Every field is a real count/total off existing
 * ledger data (Lead/Deal/Invoice/Supplier/PurchaseOrder, and — for the inventory fields —
 * AnalyticsService's own already-authoritative getDeadStock/getReorderSuggestions definitions,
 * reused rather than re-derived), never an estimate. Backs the global "what needs my attention"
 * AI tool (F2).
 */
export interface OrganizationGraphSummary {
  crm: {
    openLeadsCount: number;
    openDealsCount: number;
    openDealsValue: number;
  };
  finance: {
    overdueInvoicesCount: number;
    overdueInvoicesTotal: number;
  };
  inventory: {
    lowStockCount: number;
    deadStockCount: number;
  };
  suppliers: {
    supplierCount: number;
    pendingPurchaseOrdersCount: number;
  };
}
