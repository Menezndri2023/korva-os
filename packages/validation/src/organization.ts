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

export const updateOrganizationSchema = createOrganizationSchema.partial().extend({
  legalName: z.string().max(200).optional(),
  logo: z.string().url().optional(),
  enabledModules: z.array(z.enum(KORVA_MODULES)).optional(),
});
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

export const enabledModulesSchema = z.array(z.enum(KORVA_MODULES));

export const addMemberSchema = z.object({
  email: z.string().email(),
  roleId: z.string().min(1),
});
export type AddMemberInput = z.infer<typeof addMemberSchema>;
