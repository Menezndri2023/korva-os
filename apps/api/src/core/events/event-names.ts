import type { SystemEvent } from '@korva/types';

/** Redis/BullMQ queue that carries system events from publishers to the WorkflowEngine. */
export const EVENTS_QUEUE_NAME = 'events';

export interface EventJobData {
  organizationId: string;
  name: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  /**
   * `${name}:${entityId}` when a stable entity id could be derived from the payload (see
   * EVENT_ENTITY_ID_FIELD) — undefined otherwise. Used both as the BullMQ jobId (dedupes two
   * publish() calls for the same logical event before they ever become two jobs) and as the key
   * threaded down to WorkflowActionClaim (dedupes the resulting action effects on a BullMQ
   * retry). See EventBusService.publish().
   */
  eventKey?: string;
}

/**
 * Name of the payload field holding the entity id each event is about — verified by reading
 * every producer's publish() call (see docs/lot-q audit): each already passes this field today,
 * so no producer needs to change to support this. quote.expired/invoice.overdue are declared as
 * valid trigger names (packages/types/src/workflow.ts) but never actually published anywhere yet
 * (no scheduler emits them) — the field names below are this module's best-guess convention for
 * whenever that scheduler is built, not verified against a real producer.
 */
export const EVENT_ENTITY_ID_FIELD: Record<SystemEvent, string> = {
  'lead.created': 'leadId',
  'quote.created': 'quoteId',
  'quote.accepted': 'quoteId',
  'quote.expired': 'quoteId',
  'order.created': 'orderId',
  'payment.completed': 'paymentId',
  'booking.created': 'bookingId',
  'booking.cancelled': 'bookingId',
  'customer.created': 'contactId',
  'invoice.overdue': 'invoiceId',
};
