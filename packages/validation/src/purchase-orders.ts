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

const receivePurchaseOrderLineSchema = z.object({
  offerId: z.string().min(1),
  variantId: z.string().optional(),
  quantity: z.number().int().positive(),
});

/** Omitting `items` (or the whole request body) receives every line in full — the original
 *  one-shot behavior; passing `items` receives only those lines, by the given quantity — a
 *  partial delivery. The `.optional()` at the top level (not just on `items`) matters: a
 *  no-body POST request can arrive with `req.body` itself `undefined`, not `{}`.
 *  `warehouseId` (Phase C2) records this specific receipt against one warehouse's StockLevel —
 *  omitted keeps today's exact behavior (aggregate-only, no per-location breakdown). */
export const receivePurchaseOrderSchema = z
  .object({
    items: z.array(receivePurchaseOrderLineSchema).min(1).optional(),
    warehouseId: z.string().optional(),
  })
  .optional()
  .transform((value) => value ?? {});
export type ReceivePurchaseOrderInput = z.infer<typeof receivePurchaseOrderSchema>;

export const listPurchaseOrdersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(PURCHASE_ORDER_STATUSES).optional(),
  supplierId: z.string().optional(),
});
export type ListPurchaseOrdersQuery = z.infer<typeof listPurchaseOrdersQuerySchema>;
