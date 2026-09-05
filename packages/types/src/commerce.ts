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
  /** Set when AbandonedCartReminderSchedulerService sends a recovery message and transitions
   *  status to 'abandoned' — the dedup marker preventing a second reminder for the same episode. */
  notifiedAt?: string;
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
  resourceId?: string;
  invoiceId?: string;
  items: LineItem[];
  currency: string;
  subtotal: number;
  taxTotal: number;
  discountCodeId?: string;
  discountTotal: number;
  shippingCost: number;
  shippingAddress?: {
    line1: string;
    line2?: string;
    city: string;
    postalCode: string;
    country: string;
  };
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

export const RETURN_REQUEST_STATUSES = ["pending", "approved", "rejected"] as const;
export type ReturnRequestStatus = (typeof RETURN_REQUEST_STATUSES)[number];

export interface ReturnRequestItem {
  lineItemIndex: number;
  offerId?: string;
  variantId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

/** A customer- or staff-initiated request to return some (or all) of an already-fulfilled
 *  Order's line items. Approving one triggers a real refund against the order's payment (via
 *  the existing Payments/Refund pipeline) and restocks any tracked-stock offers involved —
 *  see ReturnRequestsService's own doc comment in the API for the full flow. */
export interface ReturnRequest {
  id: string;
  organizationId: string;
  orderId: string;
  contactId: string;
  items: ReturnRequestItem[];
  reason: string;
  status: ReturnRequestStatus;
  refundAmount: number;
  currency: string;
  refundId?: string;
  rejectionReason?: string;
  reviewedByUserId?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
}
