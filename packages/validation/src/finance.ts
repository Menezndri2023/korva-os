import { z } from "zod";
import {
  EXPENSE_STATUSES,
  INVOICE_STATUSES,
  QUOTE_STATUSES,
  TIME_ENTRY_STATUSES,
} from "@korva/types";

export const lineItemInputSchema = z.object({
  offerId: z.string().optional(),
  description: z.string().min(1).max(300),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  taxRate: z.number().min(0).max(100).optional(),
});
export type LineItemInput = z.infer<typeof lineItemInputSchema>;

export const createQuoteSchema = z.object({
  contactId: z.string().min(1),
  items: z.array(lineItemInputSchema).min(1),
  currency: z.string().length(3),
  validUntil: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
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
});
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;

export const createRefundSchema = z.object({
  paymentId: z.string().min(1),
  amount: z.number().positive(),
  reason: z.string().max(500).optional(),
});
export type CreateRefundInput = z.infer<typeof createRefundSchema>;

export const createExpenseSchema = z.object({
  category: z.string().min(1).max(100),
  description: z.string().min(1).max(300),
  amount: z.number().positive(),
  currency: z.string().length(3),
  date: z.string().datetime(),
  vendor: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
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
});
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

export const listExpensesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(EXPENSE_STATUSES).optional(),
  category: z.string().optional(),
});
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;

export const createTimeEntrySchema = z
  .object({
    contactId: z.string().min(1),
    userId: z.string().min(1).optional(),
    date: z.string().datetime(),
    durationMinutes: z.number().int().positive().max(24 * 60),
    description: z.string().min(1).max(300),
    billable: z.boolean().default(true),
    hourlyRate: z.number().positive().optional(),
    currency: z.string().length(3),
    notes: z.string().max(2000).optional(),
  })
  .refine((v) => v.billable === false || v.hourlyRate !== undefined, {
    message: "hourlyRate is required for billable time entries",
    path: ["hourlyRate"],
  });
export type CreateTimeEntryInput = z.infer<typeof createTimeEntrySchema>;

export const updateTimeEntrySchema = z.object({
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
