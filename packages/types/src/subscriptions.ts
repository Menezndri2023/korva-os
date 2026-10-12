import type { KorvaModule } from "./organization.ts";
import type { KorvaProduct } from "./products.ts";

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
 * "past_due" is set by SubscriptionPeriodSchedulerService when a paid plan's previous
 * SubscriptionInvoice is still unpaid past its grace window (see that service's resolveRenewal).
 * A free plan (priceAmount <= 0) issues no invoice and can therefore never reach this state —
 * it simply renews forever, exactly as it always has.
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
   * a credit. Still never charged/credited — SubscriptionInvoice bills the plan's full
   * priceAmount for the period and ignores this field. Applying it is a pricing decision (invoice
   * the delta now, or fold it into the next period), not a missing integration.
   */
  prorationAmount: number | null;
  prorationCurrency: string | null;
  prorationCalculatedAt: string | null;
  /** Independent of planId.modules — see resolveEffectiveModules in products.ts. Absent/empty
   *  means zero behavior change (today's pure plan-driven entitlement). */
  productOverrides?: Partial<Record<KorvaProduct, boolean>>;
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

/**
 * KORVA's own invoice to a tenant organization for one subscription period ("Flow A" in
 * docs/architecture/integrations-platform.md §4 — KORVA is the issuer, the tenant is the payer).
 *
 * Deliberately NOT the `Invoice` entity in finance/: that one is the tenant's invoice to its own
 * end-customer. It requires a `contactId` from the tenant's CRM (KORVA has none, and fabricating
 * one inside a tenant's contact list would be wrong), and AnalyticsService aggregates it into
 * the tenant's own revenue/outstanding figures — so billing KORVA's SaaS fees through it would
 * show up as money the TENANT is owed. Separate collection, never read by any finance/analytics
 * query.
 */
export const SUBSCRIPTION_INVOICE_STATUSES = ["open", "paid", "void"] as const;
export type SubscriptionInvoiceStatus =
  (typeof SUBSCRIPTION_INVOICE_STATUSES)[number];

export interface SubscriptionInvoice {
  id: string;
  /** The tenant being billed — NOT a scoping key for tenant-owned data, but kept as the
   *  organization dimension so a tenant can read its own KORVA billing history. */
  organizationId: string;
  subscriptionId: string;
  planId: string;
  /** Per-organization sequence, "ABO-0001" (CountersService, key 'subscription-invoice'). */
  number: string;
  status: SubscriptionInvoiceStatus;
  /** The period this invoice covers — equal to the Subscription period it was issued for. */
  periodStart: string;
  periodEnd: string;
  amount: number;
  currency: string;
  issuedAt: string;
  /** Payment is due by this date; past it, the next sweep moves the subscription to past_due. */
  dueAt: string;
  paidAt: string | null;
  /** PSP reference for the hosted checkout last created for this invoice; null until a payment
   *  link is requested. */
  providerReference: string | null;
  /** The hosted checkout URL `providerReference` belongs to. */
  checkoutUrl: string | null;
  createdAt: string;
  updatedAt: string;
}
