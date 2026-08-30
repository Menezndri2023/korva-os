import type { LineItem } from "./finance.ts";

export const CART_STATUSES = ["open", "converted", "abandoned"] as const;
export type CartStatus = (typeof CART_STATUSES)[number];

export interface CartItem {
  id: string;
  offerId: string;
  quantity: number;
}

export interface Cart {
  id: string;
  organizationId: string;
  contactId: string;
  status: CartStatus;
  items: CartItem[];
  createdAt: string;
  updatedAt: string;
}

export const ORDER_STATUSES = ["open", "pending", "confirmed", "fulfilled", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_SOURCES = ["cart", "booking", "manual", "storefront"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

export interface Order {
  id: string;
  organizationId: string;
  contactId: string;
  number: string;
  status: OrderStatus;
  source: OrderSource;
  bookingId?: string;
  invoiceId?: string;
  items: LineItem[];
  currency: string;
  subtotal: number;
  taxTotal: number;
  discountCodeId?: string;
  discountTotal: number;
  total: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export const FULFILLMENT_STATUSES = ["pending", "shipped", "delivered", "cancelled"] as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

export interface Fulfillment {
  id: string;
  organizationId: string;
  orderId: string;
  status: FulfillmentStatus;
  carrier?: string;
  trackingNumber?: string;
  shippedAt?: string;
  deliveredAt?: string;
  createdAt: string;
  updatedAt: string;
}
