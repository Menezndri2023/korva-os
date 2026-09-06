import { z } from "zod";
import { TICKET_PRIORITIES, TICKET_STATUSES } from "@korva/types";

const customFieldsSchema = z.record(z.string(), z.unknown()).optional();

export const createTicketSchema = z.object({
  subject: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  priority: z.enum(TICKET_PRIORITIES).default("medium"),
  contactId: z.string().min(1),
  conversationId: z.string().min(1).optional(),
  customFields: customFieldsSchema,
});
export type CreateTicketInput = z.infer<typeof createTicketSchema>;

// Status is deliberately absent — only ever changed via the dedicated transition endpoints
// (assign/resolve/close/reopen), each with its own guard, never a generic field edit.
export const updateTicketSchema = z.object({
  subject: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  customFields: customFieldsSchema,
});
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;

export const assignTicketSchema = z.object({
  assigneeMembershipId: z.string().min(1),
});
export type AssignTicketInput = z.infer<typeof assignTicketSchema>;

export const listTicketsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(TICKET_STATUSES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  assigneeMembershipId: z.string().optional(),
  contactId: z.string().optional(),
});
export type ListTicketsQuery = z.infer<typeof listTicketsQuerySchema>;

// No contactId field — the customer-portal controller derives it from the verified JWT, never
// from client input.
export const createCustomerTicketSchema = z.object({
  subject: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
});
export type CreateCustomerTicketInput = z.infer<typeof createCustomerTicketSchema>;

export const listCustomerTicketsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListCustomerTicketsQuery = z.infer<typeof listCustomerTicketsQuerySchema>;
