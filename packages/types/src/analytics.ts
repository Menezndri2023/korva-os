import type { LeadStatus } from "./crm.ts";
import type { OrderStatus } from "./commerce.ts";
import type { InvoiceStatus } from "./finance.ts";

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
