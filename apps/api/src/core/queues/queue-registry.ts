import { EVENTS_QUEUE_NAME } from '../events/event-names';
import { RECONCILIATION_QUEUE_NAME } from '../../finance/payments/reconciliation-scheduler.service';
import { QUOTE_EXPIRY_QUEUE_NAME } from '../../finance/quotes/quote-expiry-scheduler.service';
import { INVOICE_OVERDUE_QUEUE_NAME } from '../../finance/invoices/invoice-overdue-scheduler.service';
import { RECURRING_BILLING_QUEUE_NAME } from '../../finance/recurring-billing/recurring-billing-scheduler.service';
import { CALENDAR_SYNC_QUEUE_NAME } from '../../booking/resources/calendar-sync-scheduler.service';
import { BOOKING_REMINDER_QUEUE_NAME } from '../../booking/bookings/booking-reminder-scheduler.service';
import { CUSTOMER_INACTIVITY_QUEUE_NAME } from '../../crm/contacts/customer-inactivity-scheduler.service';
import { WEBHOOK_DELIVERY_QUEUE_NAME } from '../../webhook-subscriptions/webhook-delivery.queue';
import { SUBSCRIPTION_PERIOD_QUEUE_NAME } from '../../subscriptions/subscription-period-scheduler.service';
import { ABANDONED_CART_QUEUE_NAME } from '../../commerce/carts/abandoned-cart-reminder-scheduler.service';
import { CAMPAIGN_SEND_QUEUE_NAME } from '../../marketing/campaigns/campaign-send.queue';

/**
 * Every BullMQ queue this application runs — the single list both observability consumers read
 * (QueueAlertingService's failure alerts and QueueMetricsService's job counts, which feed
 * GET /health/queues and GET /metrics).
 *
 * This file exists because the two lists had drifted independently. Failure alerting covered 8
 * queues and its own comment claimed that was "all 8 registered queues", while 12 queues
 * actually existed — 'recurring-billing', 'booking-reminder', 'abandoned-cart-reminder' and
 * 'campaign-sends' (all real producer+worker pairs) had no failure signal at all — and queue
 * metrics covered only 2 of the 12. Two hand-maintained arrays in two files is what let that
 * happen quietly.
 *
 * ADDING A QUEUE: add its name constant here and nowhere else. Both consumers pick it up
 * automatically, so a new queue can no longer ship with zero observability.
 */
export const ALL_QUEUE_NAMES = [
  EVENTS_QUEUE_NAME,
  RECONCILIATION_QUEUE_NAME,
  QUOTE_EXPIRY_QUEUE_NAME,
  INVOICE_OVERDUE_QUEUE_NAME,
  RECURRING_BILLING_QUEUE_NAME,
  CALENDAR_SYNC_QUEUE_NAME,
  BOOKING_REMINDER_QUEUE_NAME,
  CUSTOMER_INACTIVITY_QUEUE_NAME,
  WEBHOOK_DELIVERY_QUEUE_NAME,
  SUBSCRIPTION_PERIOD_QUEUE_NAME,
  ABANDONED_CART_QUEUE_NAME,
  CAMPAIGN_SEND_QUEUE_NAME,
] as const;
