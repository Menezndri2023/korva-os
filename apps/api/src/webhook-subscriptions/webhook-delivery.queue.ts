import type { SystemEvent } from '@korva/types';

export const WEBHOOK_DELIVERY_QUEUE_NAME = 'webhook-deliveries';

export interface WebhookDeliveryJobData {
  deliveryId: string;
  subscriptionId: string;
  eventName: SystemEvent;
  payload: Record<string, unknown>;
}

/**
 * 5 attempts, exponential-from-2s — mirrors EventBusService's own per-event retry budget (the
 * closer analog for "one delivery attempt" than a periodic sweep's 3). A partner endpoint down
 * for a brief blip gets several real chances spread over ~30s before this gives up and the
 * delivery is logged 'failed' for good (see WebhookDeliveryWorker's 'failed' handler) — there is
 * no broader periodic re-sweep beyond these attempts, unlike PaymentReconciliationService.
 */
export const WEBHOOK_DELIVERY_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: false,
} as const;
