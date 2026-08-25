import type { KorvaModule } from "./organization.ts";

export const PLAN_INTERVALS = ["month", "year"] as const;
export type PlanInterval = (typeof PLAN_INTERVALS)[number];

/** -1 in a limit means unlimited. */
export interface Plan {
  id: string;
  key: string;
  name: string;
  priceAmount: number;
  priceCurrency: string;
  interval: PlanInterval;
  modules: KorvaModule[];
  limits: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

/**
 * "trialing" is intentionally NOT modeled yet: Plan (see plan.schema.ts) has no trial-related
 * field anywhere in this codebase, so there is no real trial concept to drive that state —
 * adding it here would be a state nothing could ever transition into or out of. Add it once a
 * real trial concept exists on Plan.
 *
 * "past_due" is modeled as a state and included in the transition shape (see
 * SubscriptionsService/SubscriptionPeriodSchedulerService) but nothing sets it yet — it only
 * becomes reachable once a real PSP integration can report a failed payment attempt. Until then
 * a subscription with no payment collection simply renews (see the scheduler).
 */
export const SUBSCRIPTION_STATUSES = [
  "active",
  "past_due",
  "canceled",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface Subscription {
  id: string;
  organizationId: string;
  planId: string;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  /** Whether the subscription is scheduled to become 'canceled' once currentPeriodEnd is reached. */
  cancelAtPeriodEnd: boolean;
  /** When cancelAtPeriodEnd was last set to true (POST /subscriptions/cancel with immediate=false). */
  cancelRequestedAt: string | null;
  /** When status actually became 'canceled' — set either by an immediate cancel or by the scheduler. */
  canceledAt: string | null;
  /**
   * Computed, stored-only proration from the most recent changePlan() mid-period — positive
   * means the new plan is more expensive for the remaining period (amount owed), negative means
   * a credit. Never actually charged/credited: there is no PSP integration yet to apply it.
   */
  prorationAmount: number | null;
  prorationCurrency: string | null;
  prorationCalculatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UsageSummaryItem {
  metric: string;
  used: number;
  limit: number;
}

export interface SubscriptionSummary {
  subscription: Subscription;
  plan: Plan;
  usage: UsageSummaryItem[];
}
