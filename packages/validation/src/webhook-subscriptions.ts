import { z } from "zod";
import { SYSTEM_EVENTS } from "@korva/types";

export const createWebhookSubscriptionSchema = z.object({
  url: z.string().url().max(2000),
  events: z.array(z.enum(SYSTEM_EVENTS)).min(1),
  description: z.string().max(200).optional(),
});
export type CreateWebhookSubscriptionInput = z.infer<
  typeof createWebhookSubscriptionSchema
>;

export const updateWebhookSubscriptionSchema = createWebhookSubscriptionSchema
  .partial()
  .extend({
    active: z.boolean().optional(),
  });
export type UpdateWebhookSubscriptionInput = z.infer<
  typeof updateWebhookSubscriptionSchema
>;

export const listWebhookDeliveriesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListWebhookDeliveriesQuery = z.infer<
  typeof listWebhookDeliveriesQuerySchema
>;
