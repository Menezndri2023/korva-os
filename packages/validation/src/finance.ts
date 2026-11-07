import { z } from "zod";
import {
  EXPENSE_STATUSES,
  INVOICE_STATUSES,
  QUOTE_STATUSES,
  RECURRING_BILLING_INTERVALS,
  TIME_ENTRY_STATUSES,
} from "@korva/types";

export const lineItemModifierSchema = z.object({
  name: z.string().min(1).max(100),
  priceDelta: z.number(),
});
export type LineItemModifierInput = z.infer<typeof lineItemModifierSchema>;

export const lineItemInputSchema = z.object({
  offerId: z.string().optional(),
  variantId: z.string().optional(),
  description: z.string().min(1).max(300),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  taxRate: z.number().min(0).max(100).optional(),
  modifiers: z.array(lineItemModifierSchema).max(20).optional(),
});
export type LineItemInput = z.infer<typeof lineItemInputSchema>;

export const createQuoteSchema = z.object({
  contactId: z.string().min(1),
  items: z.array(lineItemInputSchema).min(1),
  currency: z.string().length(3),
  validUntil: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
  discountCode: z.string().max(40).optional(),
});
export type CreateQuoteInput = z.infer<typeof createQuoteSchema>;

export const updateQuoteSchema = z.object({
  items: z.array(lineItemInputSchema).min(1).optional(),
  validUntil: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
});
export type UpdateQuoteInput = z.infer<typeof updateQuoteSchema>;

export const listQuotesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(QUOTE_STATUSES).optional(),
  contactId: z.string().optional(),
});
export type ListQuotesQuery = z.infer<typeof listQuotesQuerySchema>;

export const createInvoiceSchema = z.object({
  contactId: z.string().min(1),
  quoteId: z.string().optional(),
  items: z.array(lineItemInputSchema).min(1),
  currency: z.string().length(3),
  dueDate: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
  discountCode: z.string().max(40).optional(),
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export const updateInvoiceSchema = z.object({
  items: z.array(lineItemInputSchema).min(1).optional(),
  dueDate: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
});
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;

export const listInvoicesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(INVOICE_STATUSES).optional(),
  contactId: z.string().optional(),
});
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;

export const createPaymentSchema = z.object({
  invoiceId: z.string().min(1),
  amount: z.number().positive(),
  method: z.string().max(60).optional(),
  tipAmount: z.number().positive().optional(),
  tipStaffMembershipId: z.string().optional(),
});
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;

/** A counter sale paid by QR code (see CounterPayment in @korva/types). */
export const createCounterPaymentSchema = z.object({
  amount: z.number().positive().max(100_000_000),
  label: z.string().trim().max(120).optional(),
});
export type CreateCounterPaymentInput = z.infer<typeof createCounterPaymentSchema>;

/** A cash sale at the till; `key` makes a re-sent sale (offline till) the same sale. */
export const createCashSaleSchema = z.object({
  amount: z.number().positive().max(100_000_000),
  label: z.string().trim().max(120).optional(),
  key: z.string().trim().min(8).max(80),
  soldAt: z.string().datetime().optional(),
});
export type CreateCashSaleInput = z.infer<typeof createCashSaleSchema>;

export const createRefundSchema = z.object({
  paymentId: z.string().min(1),
  amount: z.number().positive(),
  reason: z.string().max(500).optional(),
});
export type CreateRefundInput = z.infer<typeof createRefundSchema>;

export const createExpenseSchema = z
  .object({
    category: z.string().min(1).max(100),
    description: z.string().min(1).max(300),
    amount: z.number().positive(),
    currency: z.string().length(3),
    date: z.string().datetime(),
    vendor: z.string().max(200).optional(),
    notes: z.string().max(2000).optional(),
    contactId: z.string().min(1).optional(),
    billable: z.boolean().default(false),
  })
  .refine((e) => !e.billable || !!e.contactId, {
    message: "contactId is required when billable is true",
    path: ["contactId"],
  });
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const updateExpenseSchema = z.object({
  category: z.string().min(1).max(100).optional(),
  description: z.string().min(1).max(300).optional(),
  amount: z.number().positive().optional(),
  currency: z.string().length(3).optional(),
  date: z.string().datetime().optional(),
  vendor: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  contactId: z.string().min(1).optional(),
  billable: z.boolean().optional(),
});
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

export const generateInvoiceFromExpensesSchema = z.object({
  expenseIds: z.array(z.string().min(1)).min(1),
  dueDate: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
});
export type GenerateInvoiceFromExpensesInput = z.infer<
  typeof generateInvoiceFromExpensesSchema
>;

export const listExpensesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(EXPENSE_STATUSES).optional(),
  category: z.string().optional(),
});
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;

// `hourlyRate` is optional even for a billable entry: when omitted, TimeEntriesService.create
// resolves it server-side (the billed contact's defaultHourlyRate, then the staff member's own
// default) and only rejects the request — TIME_ENTRY_RATE_REQUIRED — if neither exists. That
// resolution needs a database read, so it can't live in this static Zod shape.
export const createTimeEntrySchema = z.object({
  contactId: z.string().min(1),
  userId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  date: z.string().datetime(),
  durationMinutes: z.number().int().positive().max(24 * 60),
  description: z.string().min(1).max(300),
  billable: z.boolean().default(true),
  hourlyRate: z.number().positive().optional(),
  currency: z.string().length(3),
  notes: z.string().max(2000).optional(),
});
export type CreateTimeEntryInput = z.infer<typeof createTimeEntrySchema>;

export const updateTimeEntrySchema = z.object({
  projectId: z.string().min(1).optional(),
  date: z.string().datetime().optional(),
  durationMinutes: z.number().int().positive().max(24 * 60).optional(),
  description: z.string().min(1).max(300).optional(),
  billable: z.boolean().optional(),
  hourlyRate: z.number().positive().optional(),
  currency: z.string().length(3).optional(),
  notes: z.string().max(2000).optional(),
});
export type UpdateTimeEntryInput = z.infer<typeof updateTimeEntrySchema>;

export const listTimeEntriesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(TIME_ENTRY_STATUSES).optional(),
  contactId: z.string().optional(),
  userId: z.string().optional(),
  projectId: z.string().optional(),
  billable: z.coerce.boolean().optional(),
});
export type ListTimeEntriesQuery = z.infer<typeof listTimeEntriesQuerySchema>;

export const generateInvoiceFromTimeEntriesSchema = z.object({
  timeEntryIds: z.array(z.string().min(1)).min(1),
  dueDate: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
});
export type GenerateInvoiceFromTimeEntriesInput = z.infer<
  typeof generateInvoiceFromTimeEntriesSchema
>;

export const createRecurringBillingSchema = z.object({
  contactId: z.string().min(1),
  offerId: z.string().min(1),
  interval: z.enum(RECURRING_BILLING_INTERVALS),
});
export type CreateRecurringBillingInput = z.infer<
  typeof createRecurringBillingSchema
>;

export const listRecurringBillingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["active", "cancelled"]).optional(),
  contactId: z.string().optional(),
});
export type ListRecurringBillingsQuery = z.infer<
  typeof listRecurringBillingsQuerySchema
>;

/** A till report's day; today in the organization's timezone when omitted. */
export const tillReportQuerySchema = z.object({
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
    .optional(),
});
export type TillReportQuery = z.infer<typeof tillReportQuerySchema>;

/** Closing a day's till: what was counted in the drawer. One closing per day. */
export const closeTillSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
  countedCash: z.number().min(0).max(1_000_000_000),
  note: z.string().trim().max(500).optional(),
});
export type CloseTillInput = z.infer<typeof closeTillSchema>;


/** ?month=YYYY-MM — one calendar month (profit, statements). */
export const monthQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mois au format AAAA-MM"),
});
export type MonthQuery = z.infer<typeof monthQuerySchema>;

/** POST /gift-cards — a card the business sold or offers. */
export const createGiftCardSchema = z.object({
  amount: z.number().positive().max(10_000_000),
  recipientName: z.string().trim().max(120).optional(),
  recipientEmail: z.string().trim().email().max(200).optional(),
  message: z.string().trim().max(500).optional(),
  expiresAt: z.string().datetime().optional(),
  /** E-mail the code to the recipient now. */
  sendEmail: z.boolean().optional(),
});
export type CreateGiftCardInput = z.infer<typeof createGiftCardSchema>;

/** POST /gift-cards/pay — pay an invoice with a card's code (at most its balance). */
export const payWithGiftCardSchema = z.object({
  code: z.string().trim().min(4).max(40),
  invoiceId: z.string().min(1),
  amount: z.number().positive().optional(),
});
export type PayWithGiftCardInput = z.infer<typeof payWithGiftCardSchema>;
