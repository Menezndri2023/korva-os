import type { LeadStatus } from "./crm.ts";
import type { OrderStatus } from "./commerce.ts";
import type { InvoiceStatus } from "./finance.ts";
import type { BusinessModel } from "./business-models.ts";

export interface AnalyticsOverview {
  leads: {
    total: number;
    byStatus: Partial<Record<LeadStatus, number>>;
  };
  bookings: {
    total: number;
    upcoming: number;
  };
  orders: {
    total: number;
    byStatus: Partial<Record<OrderStatus, number>>;
    revenue: number;
    currency: string | null;
  };
  invoices: {
    total: number;
    byStatus: Partial<Record<InvoiceStatus, number>>;
    outstanding: number;
    currency: string | null;
  };
}

export interface AnalyticsRevenuePoint {
  /** ISO date (UTC, bucket start) — e.g. "2026-08-01". */
  date: string;
  revenue: number;
}

export interface AnalyticsRevenueTimeseries {
  points: AnalyticsRevenuePoint[];
  currency: string | null;
}

export interface AnalyticsActivityEntry {
  id: string;
  action: string;
  entity: string;
  entityId?: string;
  createdAt: string;
}

/**
 * Phase C3 (docs/KORVA_OS_V2_AUDIT.md §2.4) — read off the existing StockMovement ledger, no new
 * instrumentation. `turnoverRatio` is a simplified "units sold in period ÷ current stock" proxy,
 * not a formal weighted-average-inventory calculation — a defensible v1 starting metric.
 */
export interface InventoryTurnoverEntry {
  offerId: string;
  offerName: string;
  currentStock: number;
  unitsSoldInPeriod: number;
  turnoverRatio: number | null;
}

export interface InventoryDeadStockEntry {
  offerId: string;
  offerName: string;
  currentStock: number;
  /** Null means never sold at all (not just "not sold in the lookback window"). */
  lastSoldAt: string | null;
}

/** `unvaluedOfferCount` — offers with stock but no costed `received` movement yet, so they're
 *  excluded from `totalValue` rather than guessed at (see StockMovement.unitCost's doc). */
export interface InventoryValuationEntry {
  offerId: string;
  offerName: string;
  currentStock: number;
  unitCost: number;
  totalValue: number;
}
export interface InventoryValuation {
  entries: InventoryValuationEntry[];
  totalValue: number;
  currency: string | null;
  unvaluedOfferCount: number;
}

/** Phase C4 — offers at or below their own configured reorder point. `suggestedReorderQuantity`
 *  is a simple heuristic (at least enough to cover the last 30 days' sales, at least enough to
 *  refill to the threshold) — never a demand forecast, same "no LLM standing in for a business
 *  decision" philosophy as the Decision Engine's own rules. */
export interface ReorderSuggestionEntry {
  offerId: string;
  offerName: string;
  currentStock: number;
  lowStockThreshold: number;
  unitsSoldInLast30Days: number;
  suggestedReorderQuantity: number;
}

/** Phase C4 — per-supplier spend and on-time delivery, off the existing PurchaseOrder ledger.
 *  `onTimeDeliveryRate` is null when there's no received PO with both an expectedDate and a
 *  receivedAt to compare — never defaulted to 0 or 100%, which would misrepresent "no data". */
export interface SupplierAnalysisEntry {
  supplierId: string;
  supplierName: string;
  purchaseOrderCount: number;
  totalSpend: number;
  onTimeDeliveryRate: number | null;
}

/** One figure of AnalyticsInsights, this period beside the one just before it. */
export interface AnalyticsComparedFigure {
  current: number;
  previous: number;
}

/**
 * Pro statistics (plan feature `advanced_analytics`): the chosen period against the period of the
 * same length just before it, and who and what sold the most in it. Sales are confirmed or
 * fulfilled orders, plus confirmed or completed bookings — never a cancelled one.
 */
export interface AnalyticsInsights {
  periodDays: number;
  currency: string | null;
  ordersRevenue: AnalyticsComparedFigure;
  ordersCount: AnalyticsComparedFigure;
  averageOrder: AnalyticsComparedFigure;
  bookingsValue: AnalyticsComparedFigure;
  bookingsCount: AnalyticsComparedFigure;
  newContacts: AnalyticsComparedFigure;
  topCustomers: { contactId: string; name: string; total: number; count: number }[];
  topOffers: { offerId: string | null; name: string; total: number; quantity: number }[];
}

/** The kinds of file the dashboard can export (plan features `data_export` and, for the sales
 *  journal, `accounting_export`). */
export const DATA_EXPORT_KINDS = ["orders", "bookings", "contacts", "sales-journal"] as const;
export type DataExportKind = (typeof DATA_EXPORT_KINDS)[number];

/**
 * An export, ready to save: semicolon-separated with a UTF-8 byte order mark and decimal commas,
 * which is what Excel opens correctly in French without an import wizard.
 */
export interface DataExport {
  filename: string;
  csv: string;
  rows: number;
  /** True when the period held more rows than one file carries (EXPORT_ROW_LIMIT). */
  truncated: boolean;
}

/**
 * Business (plan feature `network_overview`): every establishment the signed-in person runs, side
 * by side over the last 30 days. Each one in its own currency — figures are never added across
 * currencies.
 */
export interface NetworkOverview {
  periodDays: number;
  establishments: {
    organizationId: string;
    name: string;
    slug: string;
    businessModel?: BusinessModel;
    currency: string;
    sales: number;
    orders: number;
    bookings: number;
    collected: number;
    newContacts: number;
  }[];
}
