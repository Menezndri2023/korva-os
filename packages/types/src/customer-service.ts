import type { CustomFieldValues } from "./custom-fields.ts";

export const TICKET_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

/**
 * A structured wrapper around a customer conversation, not a duplicate messaging system —
 * `conversationId` is optional and, when set, the actual back-and-forth happens through the
 * existing Conversation/Message model (see ConversationsService). `status` here is orthogonal to
 * Conversation.status ('open'|'closed', which only gates whether new messages can be appended):
 * this is the actual support-workflow state.
 */
export interface Ticket {
  id: string;
  organizationId: string;
  subject: string;
  description?: string;
  status: TicketStatus;
  priority: TicketPriority;
  contactId: string;
  conversationId?: string;
  assigneeMembershipId?: string;
  customFields: CustomFieldValues;
  resolvedAt?: string;
  closedAt?: string;
  createdAt: string;
  updatedAt: string;
}
