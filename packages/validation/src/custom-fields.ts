import { z } from "zod";
import { CUSTOM_FIELD_ENTITIES, CUSTOM_FIELD_TYPES } from "@korva/types";

export const createCustomFieldSchema = z.object({
  entity: z.enum(CUSTOM_FIELD_ENTITIES),
  key: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/, "key must be lowercase snake_case"),
  label: z.string().min(1).max(120),
  type: z.enum(CUSTOM_FIELD_TYPES),
  options: z.array(z.string().min(1)).optional(),
  required: z.boolean().default(false),
});
export type CreateCustomFieldInput = z.infer<typeof createCustomFieldSchema>;

export const updateCustomFieldSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  options: z.array(z.string().min(1)).optional(),
  required: z.boolean().optional(),
});
export type UpdateCustomFieldInput = z.infer<typeof updateCustomFieldSchema>;
