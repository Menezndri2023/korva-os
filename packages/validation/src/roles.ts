import { z } from "zod";
import { CORE_PERMISSIONS } from "@korva/types";

export const createRoleSchema = z.object({
  name: z.string().min(1).max(80),
  permissions: z.array(z.enum(CORE_PERMISSIONS)).default([]),
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  permissions: z.array(z.enum(CORE_PERMISSIONS)).optional(),
});
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
