export const KITCHEN_TICKET_STATUSES = [
  "new",
  "preparing",
  "ready",
  "served",
  "cancelled",
] as const;
export type KitchenTicketStatus = (typeof KITCHEN_TICKET_STATUSES)[number];

/** A live kitchen ticket for one open tab — created automatically when a table opens an order
 *  (see OrdersService.createOpen), advanced by kitchen/floor staff through new → preparing →
 *  ready → served. Deliberately carries no item list of its own: the order it's tied to is
 *  always the live source of truth for what's on it, read fresh at request time — a ticket only
 *  tracks the one piece of state an Order doesn't have, prep status. */
export interface KitchenTicket {
  id: string;
  organizationId: string;
  orderId: string;
  resourceId?: string;
  status: KitchenTicketStatus;
  createdAt: string;
  updatedAt: string;
}

/** What the kitchen display actually renders — a ticket joined with its order's live items,
 *  since the ticket alone has nothing to show. */
export interface KitchenTicketWithOrder {
  ticket: KitchenTicket;
  order: {
    id: string;
    number: string;
    items: { description: string; quantity: number }[];
    createdAt: string;
  };
}
