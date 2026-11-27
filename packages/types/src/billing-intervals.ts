// plan-tiers.ts is a value import, which is safe: it only imports types itself, so nothing here
// can close a require cycle. subscriptions.ts is type-only, for the same reason plan-tiers.ts
// keeps its own imports type-only.
import { PLAN_PRICES, type PlanKey } from "./plan-tiers.ts";
import type { BillingCurrency, PlanInterval } from "./subscriptions.ts";

/**
 * Paying for 6 months or a year at once, cheaper than month by month — the owner's decision of
 * 2026-11-27: 10 % off for 6 months, two months free for a year. A cancelled long period runs to
 * its end and is not refunded pro rata (the simplest and most common rule, also the owner's
 * choice), exactly like a month.
 *
 * Each (tier, currency, interval) is its own Plan document, priced from PLAN_PRICES through
 * planPrice() — the seed, the migration that created them, the public pricing page and the
 * dashboard all read this one function, so they cannot disagree on a price.
 */
export const PLAN_INTERVAL_MONTHS: Record<PlanInterval, number> = {
  month: 1,
  half_year: 6,
  year: 12,
};

/** Months actually paid for: 6 months at 90 %, a year at 10 months. */
const PAID_MONTHS: Record<PlanInterval, number> = {
  month: 1,
  half_year: 5.4,
  year: 10,
};

/** Order the durations are offered in. */
export const PLAN_INTERVAL_ORDER: readonly PlanInterval[] = ["month", "half_year", "year"];

export const PLAN_INTERVAL_LABELS: Record<"fr" | "en", Record<PlanInterval, string>> = {
  fr: { month: "Mensuel", half_year: "6 mois", year: "1 an" },
  en: { month: "Monthly", half_year: "6 months", year: "1 year" },
};

/** "/ mois", "/ 6 mois", "/ an" — after a price. */
export const PLAN_INTERVAL_PER: Record<"fr" | "en", Record<PlanInterval, string>> = {
  fr: { month: "/ mois", half_year: "/ 6 mois", year: "/ an" },
  en: { month: "/ month", half_year: "/ 6 months", year: "/ year" },
};

/** One period's price from a monthly price, in whole currency units. Used directly by the
 *  migration, which starts from the monthly price actually stored (a price changed with
 *  manage-plans.ts must carry over to its 6-month and yearly versions). */
export function priceForInterval(monthlyPrice: number, interval: PlanInterval): number {
  return Math.round(monthlyPrice * PAID_MONTHS[interval]);
}

/** The price of one period of `plan` in `currency` for `interval`. Free stays free. */
export function planPrice(
  currency: BillingCurrency,
  plan: PlanKey,
  interval: PlanInterval,
): number {
  return priceForInterval(PLAN_PRICES[currency][plan], interval);
}

/** What paying for the whole period at once saves against paying month by month. */
export function planIntervalSaving(
  currency: BillingCurrency,
  plan: PlanKey,
  interval: PlanInterval,
): number {
  return PLAN_PRICES[currency][plan] * PLAN_INTERVAL_MONTHS[interval] - planPrice(currency, plan, interval);
}

/** The end of a period that starts at `start` — calendar months, in UTC, the way a monthly
 *  period has always been computed here (31 January + 1 month runs over into March). */
export function addPlanInterval(start: Date, interval: PlanInterval): Date {
  const result = new Date(start);
  result.setUTCMonth(result.getUTCMonth() + PLAN_INTERVAL_MONTHS[interval]);
  return result;
}

/** A stored interval read defensively: anything unknown (an old document, a typo in a script)
 *  is treated as one month — the only length that existed before this file. */
export function normalizePlanInterval(value: unknown): PlanInterval {
  return value === "half_year" || value === "year" ? value : "month";
}
