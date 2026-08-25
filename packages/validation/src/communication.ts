import { z } from "zod";
import { COMMUNICATION_CHANNELS, CONVERSATION_STATUSES } from "@korva/types";

export const createMessageTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  channel: z.enum(COMMUNICATION_CHANNELS),
  subject: z.string().max(300).optional(),
  body: z.string().min(1).max(5000),
});
export type CreateMessageTemplateInput = z.infer<typeof createMessageTemplateSchema>;

export const updateMessageTemplateSchema = createMessageTemplateSchema.partial();
export type UpdateMessageTemplateInput = z.infer<typeof updateMessageTemplateSchema>;

export const createConversationSchema = z.object({
  contactId: z.string().min(1),
  channel: z.enum(COMMUNICATION_CHANNELS),
  subject: z.string().max(300).optional(),
});
export type CreateConversationInput = z.infer<typeof createConversationSchema>;

export const listConversationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  contactId: z.string().optional(),
  status: z.enum(CONVERSATION_STATUSES).optional(),
  channel: z.enum(COMMUNICATION_CHANNELS).optional(),
});
export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;

export const updateConversationSchema = z.object({
  status: z.enum(CONVERSATION_STATUSES),
});
export type UpdateConversationInput = z.infer<typeof updateConversationSchema>;

export const listNotificationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  // z.coerce.boolean() would treat the string "false" as truthy — enumerate the two
  // accepted literal query values explicitly instead.
  read: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export const createMessageSchema = z.object({
  body: z.string().min(1).max(5000),
  subject: z.string().max(300).optional(),
  templateId: z.string().optional(),
});
export type CreateMessageInput = z.infer<typeof createMessageSchema>;

// Resend's webhook event envelope (https://resend.com/docs/dashboard/webhooks/event-types) —
// only the fields the delivery-status handler actually reads are asserted; `.passthrough()`
// keeps the rest so an unrecognized-but-legitimate field Resend adds later doesn't fail parsing.
export const resendWebhookEventSchema = z
  .object({
    type: z.string().min(1),
    created_at: z.string().optional(),
    data: z
      .object({
        email_id: z.string().min(1),
      })
      .passthrough(),
  })
  .passthrough();
export type ResendWebhookEvent = z.infer<typeof resendWebhookEventSchema>;
