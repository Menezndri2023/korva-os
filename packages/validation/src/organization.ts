import { z } from "zod";
import { KORVA_MODULES } from "@korva/types";

export const createOrganizationSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.string().min(1).max(60),
  country: z.string().length(2),
  currency: z.string().length(3),
  timezone: z.string().min(1),
  language: z.string().min(2).max(10).default("fr"),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

/** e.g. "#1a73e8" or "#fff" — a single storefront accent color, deliberately not a full theme. */
const hexColorSchema = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Must be a hex color, e.g. #1a73e8');

export const updateOrganizationSchema = createOrganizationSchema.partial().extend({
  legalName: z.string().max(200).optional(),
  logo: z.string().url().optional(),
  brandColor: hexColorSchema.optional(),
  enabledModules: z.array(z.enum(KORVA_MODULES)).optional(),
});
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

export const enabledModulesSchema = z.array(z.enum(KORVA_MODULES));

export const addMemberSchema = z.object({
  email: z.string().email(),
  roleId: z.string().min(1),
});
export type AddMemberInput = z.infer<typeof addMemberSchema>;

/**
 * `password`/`firstName`/`lastName` are only required when the invited email has no existing
 * KORVA account yet — InvitationsService.accept enforces that conditionally, since a static
 * schema can't know in advance which branch applies (see PASSWORD_REQUIRED there).
 */
export const acceptInvitationSchema = z.object({
  password: z.string().min(8).max(72).optional(),
  firstName: z.string().min(1).max(120).optional(),
  lastName: z.string().min(1).max(120).optional(),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
