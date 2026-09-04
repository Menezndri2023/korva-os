import { z } from "zod";
import { PURCHASE_ORDER_STATUSES } from "@korva/types";

export const createSupplierSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().optional(),
  phone: z.string().min(1).max(40).optional(),
  address: z.string().max(400).optional(),
  notes: z.string().max(2000).optional(),
});
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;

export const updateSupplierSchema = createSupplierSchema.partial();
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;

export const listSuppliersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
});
export type ListSuppliersQuery = z.infer<typeof listSuppliersQuerySchema>;

const purchaseOrderLineItemInputSchema = z.object({
  offerId: z.string().min(1),
  variantId: z.string().optional(),
  quantity: z.number().int().positive(),
  unitCost: z.number().nonnegative(),
});

export const createPurchaseOrderSchema = z.object({
  supplierId: z.string().min(1),
  items: z.array(purchaseOrderLineItemInputSchema).min(1),
  expectedDate: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
});
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;

export const listPurchaseOrdersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(PURCHASE_ORDER_STATUSES).optional(),
  supplierId: z.string().optional(),
});
export type ListPurchaseOrdersQuery = z.infer<typeof listPurchaseOrdersQuerySchema>;
