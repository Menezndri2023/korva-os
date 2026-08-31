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

export interface LineItemModifier {
  name: string;
  priceDelta: number;
}

export interface LineItem {
  offerId?: string;
  variantId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate?: number;
  modifiers?: LineItemModifier[];
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
  discountCodeId?: string;
  discountTotal: number;
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
  discountCodeId?: string;
  discountTotal: number;
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
  tipAmount?: number;
  tipStaffMembershipId?: string;
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

export const EXPENSE_STATUSES = ["recorded", "invoiced", "voided"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export interface Expense {
  id: string;
  organizationId: string;
  number: string;
  status: ExpenseStatus;
  category: string;
  description: string;
  amount: number;
  currency: string;
  date: string;
  vendor?: string;
  /** Client this expense can be re-billed to — symmetric extension of the billable pattern
   *  already shipped on TimeEntry. Absent (undefined) for internal, non-billable expenses. */
  contactId?: string;
  /** Defaults to false, unlike TimeEntry.billable (which defaults true) — most expenses
   *  (office supplies, internal tooling) are never client-billable, so opt-in is the safer
   *  default here. */
  billable: boolean;
  invoiceId?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export const TIME_ENTRY_STATUSES = ["unbilled", "approved", "invoiced", "voided"] as const;
export type TimeEntryStatus = (typeof TIME_ENTRY_STATUSES)[number];

export interface TimeEntry {
  id: string;
  organizationId: string;
  contactId: string;
  userId: string;
  date: string;
  durationMinutes: number;
  description: string;
  billable: boolean;
  hourlyRate?: number;
  currency: string;
  status: TimeEntryStatus;
  invoiceId?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export const DISCOUNT_CODE_TYPES = ["percentage", "fixed"] as const;
export type DiscountCodeType = (typeof DISCOUNT_CODE_TYPES)[number];

export const DISCOUNT_CODE_SCOPES = ["all", "offers"] as const;
export type DiscountCodeScope = (typeof DISCOUNT_CODE_SCOPES)[number];

export interface DiscountCode {
  id: string;
  organizationId: string;
  code: string;
  type: DiscountCodeType;
  /** 0-100 for "percentage"; a currency amount for "fixed". */
  value: number;
  currency?: string;
  startsAt?: string;
  expiresAt?: string;
  maxRedemptions?: number;
  redemptionsCount: number;
  scope: DiscountCodeScope;
  /** Only meaningful when scope is "offers". */
  offerIds: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
