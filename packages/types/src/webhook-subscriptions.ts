import type { SystemEvent } from "./workflow.ts";

/**
 * An org-configured outbound webhook subscription — distinct from the Workflow Engine's own
 * `webhook` action (a per-workflow side effect with no signing, no retry, no dedicated log).
 * This is the first-class "external partner subscribes to KORVA events" primitive named in the
 * Business OS brief §9 / docs/BUSINESS_OS_AUDIT.md §6.
 */
export interface WebhookSubscription {
  id: string;
  organizationId: string;
  url: string;
  events: SystemEvent[];
  description?: string;
  active: boolean;
  lastDeliveryAt?: string;
  lastDeliveryStatus?: "success" | "failed";
  createdAt: string;
  updatedAt: string;
}

/** Only ever present on the create/rotate-secret response — never returned by list/get. */
export interface WebhookSubscriptionWithSecret extends WebhookSubscription {
  secret: string;
}

export const WEBHOOK_DELIVERY_STATUSES = ["pending", "success", "failed"] as const;
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number];

export interface WebhookDelivery {
  id: string;
  subscriptionId: string;
  eventName: SystemEvent;
  status: WebhookDeliveryStatus;
  attempts: number;
  responseStatus?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
