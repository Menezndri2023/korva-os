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
 *
 * 'payment.webhook_received'/'whatsapp.status_updated' (Wave 4 FOUND-WEBHOOK,
 * see integration-webhook.service.ts) are in the same "declared but not yet verified against a
 * real producer" bucket as quote.expired/invoice.overdue above — Stage 1 builds only the generic,
 * provider-agnostic ingestion pipeline (no real Flutterwave/360dialog adapter exists yet), so
 * 'paymentId'/'messageId' here are this module's chosen convention for what
 * IntegrationWebhookService.process() actually publishes: the provider's own event id, since this
 * generic layer has no Stage-2 IntegrationAccount mapping yet to resolve a real KORVA Payment/
 * Message document. 'paymentId' was picked over e.g. 'providerEventId' to match this table's
 * existing 'payment.completed': 'paymentId' entry; 'messageId' mirrors the Resend pipeline's own
 * Message-shaped domain (see communication/webhooks/resend-webhook.service.ts).
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
  'booking.reminder_sent': 'bookingId',
  'booking.completed': 'bookingId',
  'customer.created': 'contactId',
  'invoice.overdue': 'invoiceId',
  'customer.inactive': 'contactId',
  'payment.webhook_received': 'paymentId',
  'whatsapp.status_updated': 'messageId',
  'offer.created': 'offerId',
  'offer.stock_depleted': 'offerId',
  'discount_code.redeemed': 'discountCodeId',
  'discount_code.exhausted': 'discountCodeId',
  'message.sent': 'messageId',
  'subscription.plan_changed': 'subscriptionId',
  'expense.created': 'expenseId',
  'recurring_billing.created': 'recurringBillingId',
  'recurring_billing.charged': 'recurringBillingId',
  'recurring_billing.cancelled': 'recurringBillingId',
};
