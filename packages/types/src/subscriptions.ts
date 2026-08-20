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

export const SUBSCRIPTION_STATUSES = ["active", "canceled"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface Subscription {
  id: string;
  organizationId: string;
  planId: string;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
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
