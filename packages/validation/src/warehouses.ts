import { z } from "zod";

export const createWarehouseSchema = z.object({
  name: z.string().min(1).max(200),
  address: z.string().max(400).optional(),
  isDefault: z.boolean().optional(),
});
export type CreateWarehouseInput = z.infer<typeof createWarehouseSchema>;

export const updateWarehouseSchema = createWarehouseSchema.partial();
export type UpdateWarehouseInput = z.infer<typeof updateWarehouseSchema>;
