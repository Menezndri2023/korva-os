import { z } from "zod";
import { PLAN_KEYS } from "@korva/types";

/** KORVA administration — assigning a plan after collecting its payment outside the platform. */
export const assignPlanSchema = z.object({
  planKey: z.enum(PLAN_KEYS),
});
export type AssignPlanInput = z.infer<typeof assignPlanSchema>;

/** Up to three months at once: longer is a commercial decision, not a trial. */
export const extendTrialSchema = z.object({
  days: z.number().int().min(1).max(90),
});
export type ExtendTrialInput = z.infer<typeof extendTrialSchema>;

/** Why an organization is suspended — shown to the administration, kept in the audit log. */
export const suspendOrganizationSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type SuspendOrganizationInput = z.infer<typeof suspendOrganizationSchema>;
