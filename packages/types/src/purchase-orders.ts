export interface Supplier {
  id: string;
  organizationId: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export const PURCHASE_ORDER_STATUSES = [
  "draft",
  "ordered",
  "received",
  "cancelled",
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export interface PurchaseOrderLineItem {
  offerId: string;
  variantId?: string;
  /** Snapshot of the offer's (or variant's) name at the time the PO was created — same
   *  snapshot-at-creation convention used for every other line item in this codebase (order,
   *  cart, quote), so a later rename doesn't rewrite history. */
  name: string;
  quantity: number;
  unitCost: number;
}

export interface PurchaseOrder {
  id: string;
  organizationId: string;
  supplierId: string;
  items: PurchaseOrderLineItem[];
  status: PurchaseOrderStatus;
  currency: string;
  expectedDate?: string;
  notes?: string;
  receivedAt?: string;
  createdAt: string;
  updatedAt: string;
}
