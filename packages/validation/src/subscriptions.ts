import { z } from "zod";
import { KORVA_PRODUCTS, PLAN_INTERVALS, SUPPORTED_BILLING_CURRENCIES } from "@korva/types";

/** `interval`: pay for 1 month (the default, what every client sent before it existed), 6 months
 *  or a year at once. */
export const changePlanSchema = z.object({
  planKey: z.string().min(1),
  interval: z.enum(PLAN_INTERVALS).optional().default("month"),
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

/** Query for GET /plans — see SubscriptionsController.listPlans for why the currency is a
 *  parameter rather than tenant context. Optional: omitted means the platform default. */
export const listPlansQuerySchema = z.object({
  currency: z.enum(SUPPORTED_BILLING_CURRENCIES).optional(),
});
export type ListPlansQuery = z.infer<typeof listPlansQuerySchema>;
