// TYPE-ONLY IMPORTS, and they have to stay that way. organization.ts and subscriptions.ts both
// sit upstream of this file in the module graph (organization.ts -> storefront-themes.ts ->
// this file, for planMeetsMinimum), so a runtime import of either would close a require cycle.
// `Record<KorvaModule, PlanKey>` already gives MODULE_MIN_PLAN its exhaustiveness check at
// compile time, which is the only thing KORVA_MODULES was wanted for.
import type { KorvaModule } from "./organization.ts";
import type { BillingCurrency } from "./subscriptions.ts";

/**
 * The commercial catalog: which tiers exist, what each one grants, and what each one costs in
 * every currency KORVA bills in.
 *
 * THIS FILE IS THE SOURCE OF TRUTH, and it exists because there were previously two.
 * `PLAN_KEYS`/`PLAN_RANK`/`planMeetsMinimum` lived in storefront-themes.ts with a comment
 * saying they "mirror PlansService.DEFAULT_PLANS ... update both together", while the module
 * lists and prices lived in apps/api/src/subscriptions/plans.service.ts. They drifted, exactly
 * as that arrangement invites: by 2026-10-13 `free` granted all eleven modules while `starter`
 * granted nine, so paying KORVA money *removed* `workflow` and `ai` from an organization.
 *
 * Now plans.service.ts derives its seed catalog from the constants here, apps/web renders its
 * pricing page from them, and the ladder is monotonic BY CONSTRUCTION rather than by two people
 * remembering to edit two files. plan-tiers.spec.ts asserts the monotonicity so it stays that
 * way.
 */

export const PLAN_KEYS = ["free", "starter", "pro", "business"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

const PLAN_RANK: Record<PlanKey, number> = { free: 0, starter: 1, pro: 2, business: 3 };

/** Unrecognized plan keys rank as "free" (the lowest tier) — fail closed, never grant access. */
export function planMeetsMinimum(planKey: string, minPlan: PlanKey): boolean {
  const rank = (PLAN_RANK as Record<string, number>)[planKey] ?? 0;
  return rank >= PLAN_RANK[minPlan];
}

/** Display name stored on the Plan document, and shown wherever a tier is named. */
export const PLAN_NAMES: Record<PlanKey, string> = {
  free: "Gratuit",
  starter: "Starter",
  pro: "Pro",
  business: "Business",
};

/**
 * The lowest tier that grants each module. Declaring the threshold per module, rather than a
 * module list per tier, is what makes the ladder impossible to break: a module cannot be in
 * `starter` and missing from `pro` because there is only one number to state.
 *
 * The tiers tell one story each:
 *   free     — run the business: clients, catalogue, bookings, orders, a public site, the
 *              numbers, and the one automation its trade was configured with
 *   starter  — get paid: quotes and invoices (and, via PLAN_RANK, a real domain and a sector
 *              storefront template — see storefront-themes.ts and assertCustomDomainAllowed)
 *   pro      — reach customers at scale: campaigns, AI, a styled site
 *   business — run a network: unlimited seats, your own brand colour
 *
 * `communication` is free on purpose, not as generosity. BookingReminderSchedulerService has no
 * channel without it, and twelve of the seventeen vertical templates suggest `booking` — so
 * putting it behind a paid tier would ship a booking product that cannot confirm a booking.
 */
export const MODULE_MIN_PLAN: Record<KorvaModule, PlanKey> = {
  crm: "free",
  catalog: "free",
  booking: "free",
  commerce: "free",
  website: "free",
  analytics: "free",
  communication: "free",
  finance: "starter",
  // Free, and this one is a product decision with a reason rather than a default. All seventeen
  // vertical templates carry a `starterWorkflow`, and onboarding only creates it when `workflow`
  // made it into the organization's final module list. Putting `workflow` behind a paid tier
  // means no new account ever receives the automation its trade was configured with — the
  // coherence rules vertical-templates.spec.ts enforces would be guarding dead configuration,
  // and "your workspace is already set up" would stop being true on the day it matters most.
  // The cost is that automations are uncapped on free until a workflow-count limit exists;
  // paid differentiation sits on `finance` (Starter) and `marketing`/`ai` (Pro) instead.
  workflow: "free",
  marketing: "pro",
  ai: "pro",
};

/** The modules a tier grants. Used to seed Plan.modules and to filter onboarding's suggestions.
 *  Iterates MODULE_MIN_PLAN's own keys rather than KORVA_MODULES to keep this file free of
 *  runtime imports (see the note at the top); the Record type guarantees they are the same set. */
export function modulesForPlan(planKey: string): KorvaModule[] {
  return (Object.keys(MODULE_MIN_PLAN) as KorvaModule[]).filter((module) =>
    planMeetsMinimum(planKey, MODULE_MIN_PLAN[module]),
  );
}

/**
 * Enforced quotas. EVERY metric here is actually checked somewhere in apps/api — nothing is
 * advertised that the code does not enforce:
 *   seats                  -> EntitlementsService.assertSeatAvailable
 *   ai_messages_per_month  -> EntitlementsService.checkAndRecordUsage, from AiOrchestratorService
 * -1 means unlimited (see checkAndRecordUsage's `?? -1`).
 *
 * NOT declared here, deliberately: an email quota. There is no email metering in apps/api yet —
 * the seven EMAIL_PROVIDER.send call sites mix tenant business mail (workflow actions,
 * conversations, storefront) with platform mail (password reset, email verification, team
 * invitations), and metering the second group would lock people out of their own accounts over a
 * quota. Separating those two is its own piece of work; until it lands, an email allowance would
 * be a number nothing enforces.
 *
 * `ai_messages_per_month: 0` on free and starter is explicit rather than omitted: omitting it
 * would fall through checkAndRecordUsage's `?? -1` to UNLIMITED, which is the opposite of the
 * intent, and would matter the moment an operator granted an AI add-on with
 * scripts/set-product-overrides.ts. (That add-on then has no per-organization quota of its own —
 * limits live on the shared Plan, not the Subscription. Pre-existing, and worth knowing before
 * selling a one-off AI add-on.)
 */
export const PLAN_LIMITS: Record<PlanKey, Record<string, number>> = {
  free: { seats: 1, ai_messages_per_month: 0 },
  starter: { seats: 5, ai_messages_per_month: 0 },
  pro: { seats: 15, ai_messages_per_month: 500 },
  // Seats are unlimited; AI is not. AI costs real money per token on every call, so an
  // unlimited tier would be an uncapped liability rather than a feature.
  business: { seats: -1, ai_messages_per_month: 2000 },
};

/**
 * Monthly price per tier per currency.
 *
 * SET BY MARKET, NOT BY EXCHANGE RATE. XOF is pegged to the euro at a fixed 655.957, so
 * converting is trivially possible and commercially wrong: 29 EUR is 19 023 XOF, which is
 * roughly 2 to 6 percent of the monthly revenue of the small Abidjan salon this product is for.
 * Priced that way KORVA withdraws from its own primary market. The ladder below lands WAEMU at
 * about 52 percent of the euro price, Morocco at about 64, Canada at about 92 — the same
 * regional-pricing practice Netflix, Spotify and Microsoft use.
 *
 * Amounts are whole units of the currency (29 EUR, 9 900 XOF), matching Plan.priceAmount, and
 * are rounded to a figure that reads as a price in its own market rather than as a conversion.
 * XOF has no minor unit at all.
 *
 * Changing a price means changing it here and redeploying, which is deliberate: apps/web renders
 * the public pricing page straight from this constant, so a price edited only in the database
 * (with scripts/manage-plans.ts) would leave the website advertising a figure the billing engine
 * no longer charges. manage-plans.ts stays for one-off and negotiated rows, not for the public
 * tiers.
 */
export const PLAN_PRICES: Record<BillingCurrency, Record<PlanKey, number>> = {
  EUR: { free: 0, starter: 29, pro: 79, business: 199 },
  XOF: { free: 0, starter: 9900, pro: 24900, business: 59900 },
  MAD: { free: 0, starter: 199, pro: 499, business: 1299 },
  USD: { free: 0, starter: 29, pro: 79, business: 199 },
  CAD: { free: 0, starter: 39, pro: 109, business: 279 },
};

/**
 * The billing currency for each country KORVA sells in — the six offered by onboarding's country
 * field, and no others. A mapping for a country nobody can select is unreachable code that rots;
 * adding a country means adding it in both places, which is the point.
 *
 * This replaces letting the owner pick a currency freely. Onboarding used to show an independent
 * five-currency dropdown defaulting to EUR next to the country field, so a merchant in Morocco
 * was billed in euros unless they noticed — and a Subscription is bound for good to the currency
 * it was sold in (deliberately: see the note on the unique index in plan.schema.ts), so that
 * default was not reversible for that subscription.
 */
export const BILLABLE_COUNTRIES: ReadonlyArray<{
  code: string;
  label: string;
  currency: BillingCurrency;
  /** An IANA zone that resolves to this country, used to preselect it for a visitor on the
   *  public pricing section. Only a hint — the visitor can always pick another country. */
  timeZones: readonly string[];
}> = [
  {
    code: "FR",
    label: "France",
    currency: "EUR",
    timeZones: ["Europe/Paris"],
  },
  {
    code: "BE",
    label: "Belgique",
    currency: "EUR",
    timeZones: ["Europe/Brussels"],
  },
  {
    code: "CI",
    label: "Côte d'Ivoire",
    currency: "XOF",
    // Africa/Abidjan is the canonical zone for most of West Africa; several other countries'
    // zones are IANA links to it, so a visitor in Bamako or Lomé lands here too. They would
    // then have to pick a country from this list to sign up, which is the honest outcome
    // until KORVA sells in theirs.
    timeZones: ["Africa/Abidjan"],
  },
  {
    code: "SN",
    label: "Sénégal",
    currency: "XOF",
    timeZones: ["Africa/Dakar"],
  },
  {
    code: "MA",
    label: "Maroc",
    currency: "MAD",
    timeZones: ["Africa/Casablanca", "Africa/El_Aaiun"],
  },
  {
    code: "CA",
    label: "Canada",
    currency: "CAD",
    timeZones: [
      "America/Toronto",
      "America/Montreal",
      "America/Vancouver",
      "America/Edmonton",
      "America/Winnipeg",
      "America/Halifax",
      "America/Regina",
      "America/St_Johns",
    ],
  },
];

export const COUNTRY_CURRENCY: Record<string, BillingCurrency> =
  Object.fromEntries(
    BILLABLE_COUNTRIES.map((country) => [country.code, country.currency]),
  );

/**
 * Best guess at the visitor's country from their IANA time zone, for preselecting the pricing
 * section. Returns null rather than a default so the caller decides what "unknown" means.
 *
 * The time zone, not `navigator.language`: a Moroccan merchant very plausibly has their browser
 * set to fr-FR, which would say France. The zone reflects where the device is.
 *
 * USD is in SUPPORTED_BILLING_CURRENCIES and priced in PLAN_PRICES, but no country here selects
 * it — nothing is sold into the United States yet. The price exists because every tier is priced
 * in every billing currency (plan-tiers.spec.ts asserts it), not because that market is open.
 */
export function countryFromTimeZone(timeZone: string): string | null {
  for (const country of BILLABLE_COUNTRIES) {
    if (country.timeZones.includes(timeZone)) return country.code;
  }
  return null;
}

/** Falls back to EUR, which is also plans.service.ts's FALLBACK_BILLING_CURRENCY. */
export function currencyForCountry(countryCode: string): BillingCurrency {
  return COUNTRY_CURRENCY[countryCode.toUpperCase()] ?? "EUR";
}

/** How a price should read in each currency. Symbol placement and grouping are not cosmetic:
 *  "9 900 FCFA" is how a West African price is written, "29 €" how a French one is. */
export const CURRENCY_FORMAT: Record<
  BillingCurrency,
  { locale: string; display: (amount: number) => string }
> = {
  EUR: { locale: "fr-FR", display: (a) => `${a.toLocaleString("fr-FR")} €` },
  XOF: { locale: "fr-FR", display: (a) => `${a.toLocaleString("fr-FR")} FCFA` },
  MAD: { locale: "fr-MA", display: (a) => `${a.toLocaleString("fr-FR")} MAD` },
  USD: { locale: "en-US", display: (a) => `$${a.toLocaleString("en-US")}` },
  CAD: { locale: "fr-CA", display: (a) => `${a.toLocaleString("fr-FR")} $ CA` },
};
