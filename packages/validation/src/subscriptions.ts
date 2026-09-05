import { z } from "zod";
import { KORVA_PRODUCTS } from "@korva/types";

export const changePlanSchema = z.object({
  planKey: z.string().min(1),
});
export type ChangePlanInput = z.infer<typeof changePlanSchema>;

/**
 * `immediate: true` revokes access now (status -> 'canceled' right away). `immediate: false`
 * (the default — standard SaaS UX) keeps the subscription 'active' until currentPeriodEnd, only
 * flagging cancelAtPeriodEnd — the actual terminal transition happens later, in
 * SubscriptionPeriodSchedulerService.
 */
export const cancelSubscriptionSchema = z.object({
  immediate: z.boolean().optional().default(false),
});
export type CancelSubscriptionInput = z.infer<typeof cancelSubscriptionSchema>;

/** Full replacement of the productOverrides map — same "whole object, not a single key" idiom
 *  as updateOrganizationSchema's enabledModules. */
export const updateProductOverridesSchema = z.object({
  productOverrides: z.record(z.enum(KORVA_PRODUCTS), z.boolean()),
});
export type UpdateProductOverridesInput = z.infer<
  typeof updateProductOverridesSchema
>;
