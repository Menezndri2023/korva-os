import { z } from "zod";
import { ORDER_STATUSES, FULFILLMENT_STATUSES } from "@korva/types";
import { lineItemInputSchema, lineItemModifierSchema } from "./finance.ts";

export const createCartSchema = z.object({
  contactId: z.string().min(1),
});
export type CreateCartInput = z.infer<typeof createCartSchema>;

export const addCartItemSchema = z.object({
  offerId: z.string().min(1),
  quantity: z.number().positive(),
});
export type AddCartItemInput = z.infer<typeof addCartItemSchema>;

export const updateCartItemSchema = z.object({
  quantity: z.number().positive(),
});
export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;

export const createOrderSchema = z.object({
  contactId: z.string().min(1),
  items: z.array(lineItemInputSchema).min(1),
  currency: z.string().length(3),
  notes: z.string().max(2000).optional(),
  discountCode: z.string().max(40).optional(),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const createOrderFromBookingSchema = z.object({
  bookingId: z.string().min(1),
});
export type CreateOrderFromBookingInput = z.infer<typeof createOrderFromBookingSchema>;

export const createOpenOrderSchema = z.object({
  contactId: z.string().min(1),
  currency: z.string().length(3),
  bookingId: z.string().optional(),
  resourceId: z.string().optional(),
  notes: z.string().max(2000).optional(),
});
export type CreateOpenOrderInput = z.infer<typeof createOpenOrderSchema>;

export const addOrderItemSchema = z.object({
  offerId: z.string().min(1),
  quantity: z.number().positive(),
  modifiers: z.array(lineItemModifierSchema).max(20).optional(),
});
export type AddOrderItemInput = z.infer<typeof addOrderItemSchema>;

export const listOrdersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(ORDER_STATUSES).optional(),
  contactId: z.string().optional(),
});
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;

export const updateFulfillmentSchema = z.object({
  status: z.enum(FULFILLMENT_STATUSES),
  carrier: z.string().max(100).optional(),
  trackingNumber: z.string().max(120).optional(),
});
export type UpdateFulfillmentInput = z.infer<typeof updateFulfillmentSchema>;
