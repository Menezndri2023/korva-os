export const QUOTE_STATUSES = ["draft", "sent", "viewed", "accepted", "rejected", "expired"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const INVOICE_STATUSES = [
  "draft",
  "issued",
  "partially_paid",
  "paid",
  "overdue",
  "cancelled",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_STATUSES = ["pending", "processing", "completed", "failed", "refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface LineItem {
  offerId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate?: number;
}

export interface Quote {
  id: string;
  organizationId: string;
  contactId: string;
  number: string;
  status: QuoteStatus;
  items: LineItem[];
  currency: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  validUntil?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Invoice {
  id: string;
  organizationId: string;
  contactId: string;
  quoteId?: string;
  number: string;
  status: InvoiceStatus;
  items: LineItem[];
  currency: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  dueDate?: string;
  issuedAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  organizationId: string;
  invoiceId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  provider: string;
  providerReference?: string;
  method?: string;
  createdAt: string;
}

export interface Refund {
  id: string;
  organizationId: string;
  paymentId: string;
  amount: number;
  reason?: string;
  createdAt: string;
}
