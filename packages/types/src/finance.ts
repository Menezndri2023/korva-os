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
  /** Set only when accepted through the customer portal's "sign" flow (not a cryptographic
   *  signature — a typed full name + timestamp + IP, the honest lightweight version — see
   *  CustomerAuthService#signQuote). A quote accepted by staff on the customer's behalf never
   *  has these set. */
  signedByName?: string;
  signedAt?: string;
  signedIp?: string;
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

export const RECURRING_BILLING_INTERVALS = ["monthly", "yearly"] as const;
export type RecurringBillingInterval = (typeof RECURRING_BILLING_INTERVALS)[number];

export const RECURRING_BILLING_STATUSES = ["active", "cancelled"] as const;
export type RecurringBillingStatus = (typeof RECURRING_BILLING_STATUSES)[number];

/**
 * A business's own recurring billing plan for one of ITS customers (e.g. a monthly retainer,
 * a yearly membership) — deliberately named differently from `Subscription` elsewhere in
 * @korva/types, which is KORVA's own platform/SaaS billing for the organization itself. Two
 * unrelated concepts that happen to both be "recurring billing," kept unambiguous by name (see
 * apps/api/src/finance/payments/providers/payment-provider-resolver.service.ts's own
 * PaymentResolutionFlow 'subscription' vs 'commerce' split for the same distinction elsewhere
 * in this codebase).
 */
export interface RecurringBilling {
  id: string;
  organizationId: string;
  contactId: string;
  offerId: string;
  interval: RecurringBillingInterval;
  status: RecurringBillingStatus;
  /** Snapshotted from the offer's price at creation time — a later price change on the offer
   *  never silently changes what an existing plan bills. */
  amount: number;
  currency: string;
  nextBillingDate: string;
  lastInvoiceId?: string;
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
}
