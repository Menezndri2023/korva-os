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

/** Sign-in to KORVA's administration (its own accounts, not the businesses' users). */
export const platformAdminLoginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(200),
});
export type PlatformAdminLoginInput = z.infer<typeof platformAdminLoginSchema>;

/** An administrator choosing their own password after receiving a generated one. */
export const platformAdminPasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(12).max(200),
});
export type PlatformAdminPasswordInput = z.infer<typeof platformAdminPasswordSchema>;
