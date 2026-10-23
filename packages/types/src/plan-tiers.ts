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
 *   starter  — get paid and bring people back: quotes, invoices and campaigns (and, via
 *              PLAN_RANK, a real domain — see assertCustomDomainAllowed)
 *   pro      — the assistant and a styled site: AI, and a free choice of palette and fonts
 *   business — run a network: unlimited seats, your own brand colour
 *
 * `communication` is free on purpose, not as generosity. BookingReminderSchedulerService has no
 * channel without it, and twelve of the seventeen vertical templates suggest `booking` — so
 * putting it behind a paid tier would ship a booking product that cannot confirm a booking.
 */
/**
 * The lowest plan that may connect a custom domain.
 *
 * Shared, not written out at each site, because this gate has to hold in TWO places that are
 * easy to let drift: `EntitlementsService.assertCustomDomainAllowed` when the domain is SAVED,
 * and `PublicService.resolveDomain` every time it is READ — the latter also being Caddy's
 * on-demand-TLS `ask`. The read-time check was missing until 2026-10-14, so one month of Starter
 * bought a custom domain for good.
 */
export const CUSTOM_DOMAIN_MIN_PLAN: PlanKey = "starter";

/**
 * Capabilities that are not a whole module but still belong to a tier — the V3 grid validated on
 * 2026-10-19 (docs/KORVA_OS_V3_STRUCTURE_PRODUIT.md §8). Free is for being seen and receiving
 * requests; getting paid, organising and bringing customers back are paid.
 *
 * ONE TABLE, read by the API (PlanFeatureGuard and the service checks named below), by the
 * dashboard to lock the matching controls, and by the pricing page — so the three cannot drift.
 * Every entry is enforced by the API; the comment names where.
 *
 *   online_payment     -> OrganizationsService.update (saving "online"), PublicService
 *                         (never offered on the storefront, payment link refused)
 *   no_korva_branding  -> PublicService#getOrganization (`poweredByKorva`)
 *   customer_accounts  -> CustomerAuthService.register (new accounts; existing ones still log in)
 *   kitchen_display    -> KitchenController (PlanFeatureGuard)
 *   offer_variants     -> OffersService (adding a variant; existing ones are kept)
 *   compare_at_price   -> OffersService (setting one; clearing is always allowed)
 *   both_channels      -> EntitlementsService.assertModulesAllowed (booking AND commerce)
 *   warehouses         -> WarehousesController writes (PlanFeatureGuard)
 *   suppliers          -> SuppliersController / PurchaseOrdersController writes (PlanFeatureGuard)
 *
 * Downgrading never deletes: data created under a higher plan stays readable, and only the act
 * of adding more is refused.
 */
export const PLAN_FEATURE_MIN_PLAN = {
  online_payment: "starter",
  no_korva_branding: "starter",
  customer_accounts: "starter",
  kitchen_display: "starter",
  offer_variants: "starter",
  compare_at_price: "starter",
  both_channels: "starter",
  warehouses: "pro",
  suppliers: "pro",
} as const satisfies Record<string, PlanKey>;
export type PlanFeature = keyof typeof PLAN_FEATURE_MIN_PLAN;

/** Owner-facing name of each feature, for locks in the dashboard and the pricing page. */
export const PLAN_FEATURE_LABELS: Record<PlanFeature, string> = {
  online_payment: "Paiement en ligne",
  no_korva_branding: "Site sans la mention « Propulsé par KORVA »",
  customer_accounts: "Espace client sur votre site",
  kitchen_display: "Écran cuisine",
  offer_variants: "Variantes de produits",
  compare_at_price: "Prix barré (promotions)",
  both_channels: "Réservations et commandes en même temps",
  warehouses: "Plusieurs entrepôts",
  suppliers: "Fournisseurs et bons de commande",
};

export function planHasFeature(planKey: string, feature: PlanFeature): boolean {
  return planMeetsMinimum(planKey, PLAN_FEATURE_MIN_PLAN[feature]);
}

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
  // paid differentiation sits on `finance` and `marketing` (Starter) instead.
  workflow: "free",
  // Starter, not Pro. Starter otherwise added exactly ONE module (finance) over the free plan,
  // which reads as thin on a pricing page next to Pro's two modules plus the palette and font
  // choice. Moving campaigns down gives Starter a two-part promise — get paid, and bring
  // customers back — and leaves Pro selling the AI assistant and the refined storefront, which
  // are the two things that genuinely cost more to serve.
  marketing: "starter",
  // Every plan since 2026-10-23 (KORVA IA): the assistant of the business's trade is what makes
  // KORVA different from a website builder, so every business meets it — the plans differ by how
  // many messages they get (PLAN_LIMITS.ai_messages_per_month), and AI_MONTHLY_BUDGET_USD caps
  // what the platform as a whole can spend.
  ai: "free",
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
 * `ai_messages_per_month` is set on EVERY tier, never omitted: omitting it would fall through
 * checkAndRecordUsage's `?? -1` to UNLIMITED. Free gets a taste (30), Starter enough for a weekly
 * habit (150), Pro and Business daily use. Limits live on the shared Plan, not the Subscription.
 */
export const PLAN_LIMITS: Record<PlanKey, Record<string, number>> = {
  free: { seats: 1, offers: 30, bookable_staff: 3, workflows: 1, ai_messages_per_month: 30 },
  starter: { seats: 3, offers: -1, bookable_staff: -1, workflows: 5, ai_messages_per_month: 150 },
  pro: { seats: 10, offers: -1, bookable_staff: -1, workflows: -1, ai_messages_per_month: 500 },
  // AI stays capped on every tier: it costs real money per token on every call, so an unlimited
  // tier would be an uncapped liability rather than a feature. Seats were unlimited on Business
  // until 2026-10-19; 25 plus paid extra seats lets a large network be priced fairly.
  business: { seats: 25, offers: -1, bookable_staff: -1, workflows: -1, ai_messages_per_month: 2000 },
};

/**
 * Quotas counted on what EXISTS rather than on what was done this month — the opposite of
 * ai_messages_per_month, which UsageRepository meters per period. Enforced on creation (and on
 * anything that brings an item back into the count), never by deleting: an organization already
 * above a limit after a downgrade or after this grid changed keeps everything it has and only
 * stops adding (docs/KORVA_OS_V3_STRUCTURE_PRODUIT.md §8, "rien n'est effacé").
 *
 *   seats          -> EntitlementsService.assertSeatAvailable (dashboard logins; suspended
 *                     memberships excluded, invited ones included)
 *   offers         -> OffersService.create / un-archiving (archived offers do not count)
 *   bookable_staff -> ResourcesService.create / update (active resources of type "person" —
 *                     bookable team members; places and equipment are not capped)
 *   workflows      -> WorkflowsService.create
 */
export const COUNTED_METRICS = ["seats", "offers", "bookable_staff", "workflows"] as const;
export type CountedMetric = (typeof COUNTED_METRICS)[number];

/**
 * Monthly price of one dashboard user beyond the plan's seats, validated 2026-10-19.
 *
 * DISPLAYED, NOT YET SOLD: no platform payment provider is configured, so nothing can charge it.
 * Until one is, reaching the seat limit is refused as before and the refusal names this price
 * and says the option is coming (EXTRA_SEAT_PURCHASABLE) — never a promise the API cannot keep.
 */
export const EXTRA_SEAT_PRICES: Record<BillingCurrency, number> = {
  EUR: 5,
  XOF: 1500,
  MAD: 39,
  USD: 5,
  CAD: 7,
};
export const EXTRA_SEAT_PURCHASABLE = false;

/**
 * The trial a new organization starts at signup (validated 2026-10-19): Pro for 14 days, then
 * back to Free with nothing deleted. Started once per organization, by onboarding
 * (POST /subscriptions/trial); the billed plan stays Free throughout, so no invoice is ever
 * issued for it. See SubscriptionsService.getActivePlan / startTrial / settleExpiredTrials.
 */
export const SIGNUP_TRIAL: { plan: PlanKey; days: number } = { plan: "pro", days: 14 };

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
 * Which currencies KORVA can ACTUALLY collect a subscription payment in — narrower than
 * SUPPORTED_BILLING_CURRENCIES, and the distinction is the point: that list is what the catalog
 * is PRICED in, this is what the configured payment provider can CHARGE.
 *
 * DEPLOYMENT CONFIGURATION, NOT A SOURCE CONSTANT. Flow A resolves a SINGLE, market-independent
 * platform account (see PaymentProviderResolverService), so the answer is a property of whichever
 * provider that deployment configured — it changes when the provider changes, and two
 * environments can legitimately differ. Hardcoding it in the catalog would be wrong the first
 * time either happens. Set `BILLING_CHARGEABLE_CURRENCIES` (comma-separated) in the environment:
 *
 *     BILLING_CHARGEABLE_CURRENCIES=XOF,USD
 *
 * UNSET MEANS NO KNOWN RESTRICTION — every supported currency is treated as chargeable. That is
 * deliberately fail-OPEN, unlike METRICS_TOKEN, and for a different reason: unset here restores
 * the behaviour that existed before this guard, whereas failing closed would refuse every paid
 * plan on every deployment that had not yet set the variable. The cost of fail-open is the old
 * failure mode (the provider rejects the currency at checkout); the cost of fail-closed would be
 * a platform that cannot sell anything.
 *
 * Why it exists: as of 2026-10-19 the candidate provider is GeniusPay, whose documented
 * currencies are XOF, XAF, CDF, USD, KES, RWF, SLE, UGX and ZMW — no EUR, no MAD, no CAD, all
 * three of which this catalog prices. A tenant billed in one of those has a priced plan nobody
 * can collect, and without a guard that surfaces when an owner clicks "pay", reaches a hosted
 * checkout and is rejected there — with an invoice already issued in their name.
 *
 * The free plan is never gated on this: it costs nothing, so no provider is involved. An
 * organization in France uses KORVA fully at the free tier. Restricting the taking of money
 * rather than the use of the product is the honest shape of the limitation.
 */
/** Every currency this catalog actually prices. Derived from PLAN_PRICES rather than imported
 *  from SUPPORTED_BILLING_CURRENCIES, because the header of this file makes its imports
 *  type-only to keep a require cycle closed — and because deriving it here means the sellable
 *  set and the priced set cannot drift apart. `Record<BillingCurrency, ...>` already guarantees
 *  the keys are exhaustive. */
function pricedCurrencies(): ReadonlyArray<BillingCurrency> {
  return Object.keys(PLAN_PRICES) as BillingCurrency[];
}

export function parseChargeableCurrencies(
  configured: string | undefined,
): ReadonlyArray<BillingCurrency> {
  const raw = (configured ?? "").trim();
  if (raw === "") return pricedCurrencies();

  const priced = pricedCurrencies() as readonly string[];
  const parsed = raw
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry): entry is BillingCurrency => priced.includes(entry));

  // A value that names only currencies this catalog does not price leaves nothing sellable at
  // all. Treating that as "no restriction" rather than "sell nothing" keeps a typo in an env var
  // from silently closing the business; the guard's own error message and this catalog are then
  // still consistent with each other.
  return parsed.length > 0 ? parsed : pricedCurrencies();
}

/** Whether KORVA can collect in this currency, given the deployment's configured set. Exact
 *  match on purpose: a lowercase or unknown code is not chargeable, because guessing here means
 *  issuing an invoice nobody can pay. */
export function isCurrencyChargeable(
  currency: string,
  chargeable: ReadonlyArray<BillingCurrency>,
): boolean {
  return (chargeable as readonly string[]).includes(currency);
}

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
