"use client";

import { useId, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  BILLABLE_COUNTRIES,
  CURRENCY_FORMAT,
  EXTRA_SEAT_PRICES,
  EXTRA_SEAT_PURCHASABLE,
  KORVA_MODULES,
  MODULE_MIN_PLAN,
  PLAN_KEYS,
  PLAN_LIMITS,
  PLAN_NAMES,
  PLAN_PAYOUT_RULES,
  PLAN_FEATURE_LABELS,
  PLAN_FEATURE_LABELS_EN,
  PLAN_FEATURE_MIN_PLAN,
  PLAN_PRICES,
  commissionPercentLabel,
  SIGNUP_TRIAL,
  countryFromTimeZone,
  currencyForCountry,
  type Locale,
  type PlanFeature,
  type PlanKey,
} from "@korva/types";
import { landingText } from "@/lib/landing-content";

/**
 * The public pricing ladder, in the visitor's own currency.
 *
 * Prices come from PLAN_PRICES in @korva/types — the same constant apps/api seeds the Plan
 * collection from — so the page and the billing engine cannot disagree. That is also why there
 * is no fetch here: `GET /plans` sits behind the auth guard, and adding a public pricing endpoint
 * would mean a new public route and a network round trip on a page whose visitors are mostly on
 * metered mobile data.
 *
 * What each tier grants is DERIVED, not written out. The module lines come from MODULE_MIN_PLAN,
 * the seat and AI figures from PLAN_LIMITS; only the storefront and domain gates are prose, and
 * landing-content.ts pairs each of those with the assertion in apps/api that enforces it. A tier
 * cannot advertise something it does not actually unlock.
 */

/** The paid features whose threshold IS this tier — read from the same table the API enforces. */
function featuresGainedAt(plan: PlanKey, locale: Locale): string[] {
  const labels = locale === "en" ? PLAN_FEATURE_LABELS_EN : PLAN_FEATURE_LABELS;
  return (Object.keys(PLAN_FEATURE_MIN_PLAN) as PlanFeature[])
    .filter((feature) => PLAN_FEATURE_MIN_PLAN[feature] === plan)
    .map((feature) => labels[feature]);
}

/** The modules whose threshold IS this tier — i.e. what you gain by moving up to it. */
function modulesGainedAt(plan: PlanKey) {
  return KORVA_MODULES.filter((module) => MODULE_MIN_PLAN[module] === plan);
}

/** "Utilisateurs" are dashboard logins — bookable staff (coiffeurs, coachs) are a separate,
 *  much larger allowance, which is the point of keeping the two words apart. */
function seatLine(plan: PlanKey, locale: Locale): string {
  const seats = PLAN_LIMITS[plan].seats;
  if (locale === "en") {
    if (seats === -1) return "Unlimited users";
    return seats === 1 ? "1 dashboard user" : `${seats} dashboard users`;
  }
  if (seats === -1) return "Utilisateurs illimités";
  return seats === 1 ? "1 utilisateur du tableau de bord" : `${seats} utilisateurs du tableau de bord`;
}

/** The counted quotas, each enforced by EntitlementsService.assertCountWithinLimit. */
function quotaLines(plan: PlanKey, locale: Locale): string[] {
  const { offers, bookable_staff: staff, workflows } = PLAN_LIMITS[plan];
  if (locale === "en") {
    return [
      offers === -1 ? "Unlimited catalogue" : `${offers} catalogue items`,
      staff === -1
        ? "Unlimited bookable team, no paid account needed"
        : `${staff} bookable team members, no paid account needed`,
      workflows === -1
        ? "Unlimited automations"
        : workflows === 1
          ? "Your trade's automation"
          : `${workflows} automations`,
    ];
  }
  return [
    offers === -1 ? "Catalogue illimité" : `${offers} offres au catalogue`,
    staff === -1
      ? "Équipe réservable illimitée, sans compte à payer"
      : `${staff} membres d'équipe réservables, sans compte à payer`,
    workflows === -1
      ? "Automatisations illimitées"
      : workflows === 1
        ? "L'automatisation de votre métier"
        : `${workflows} automatisations`,
  ];
}

function aiLine(plan: PlanKey, locale: Locale): string | null {
  const quota = PLAN_LIMITS[plan].ai_messages_per_month;
  if (!quota || quota === 0) return null;
  if (locale === "en") {
    return quota === -1 ? "Unlimited KORVA AI" : `KORVA AI: ${quota.toLocaleString("en-GB")} messages a month`;
  }
  if (quota === -1) return "KORVA IA sans limite";
  return `KORVA IA : ${quota.toLocaleString("fr-FR")} messages par mois`;
}

/** Le Solde KORVA: the commission on online sales and how withdrawals work, from the same
 *  tables WalletService applies (PLAN_COMMISSION_BASIS_POINTS, PLAN_PAYOUT_RULES). */
function paymentLines(plan: PlanKey, locale: Locale): string[] {
  const rules = PLAN_PAYOUT_RULES[plan];
  if (locale === "en") {
    return [
      `Online payment (Wave, Orange Money, MTN, Moov, card): ${commissionPercentLabel(plan).replace(",", ".")} commission + GeniusPay fees`,
      [
        rules.manualPerWeek === null ? "Withdrawals on demand" : `${rules.manualPerWeek} withdrawal on demand a week`,
        rules.dailyAutoPayout ? "daily automatic withdrawal" : "weekly automatic withdrawal",
        ...(rules.payoutFeeIncluded ? ["withdrawal fees included"] : []),
      ].join(", "),
    ];
  }
  return [
    `Paiement en ligne (Wave, Orange Money, MTN, Moov, carte) : commission ${commissionPercentLabel(plan)} + frais GeniusPay`,
    [
      rules.manualPerWeek === null ? "Retraits à la demande" : `${rules.manualPerWeek} retrait à la demande par semaine`,
      rules.dailyAutoPayout ? "retrait automatique quotidien" : "retrait automatique hebdomadaire",
      ...(rules.payoutFeeIncluded ? ["frais de retrait offerts"] : []),
    ].join(", "),
  ];
}

/**
 * The visitor's country, read through useSyncExternalStore rather than an effect.
 *
 * Intl reads the device's time zone, so the value legitimately differs between the server that
 * renders this HTML and the browser that reads it — exactly the "client-only value without a
 * hydration mismatch" case this hook exists for. Doing it as useState + useEffect(setState)
 * instead is both a cascading render and a lint error in this repo
 * (react-hooks: "Calling setState synchronously within an effect").
 *
 * `subscribe` is a no-op: a device does not change time zone mid-visit, and if it did, a
 * re-rendered price is not worth a listener. getServerSnapshot returns FR so the first paint
 * shows a real price rather than a blank, and getSnapshot returns a plain string, which React
 * compares with Object.is — equal strings are identical, so there is no render loop.
 */
const NO_SUBSCRIBE = () => () => {};
const getDetectedCountry = () =>
  countryFromTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? "FR";
const getServerCountry = () => "FR";

/** Country names in the page's language, from the browser's own data (no table to maintain). */
function countryName(code: string, fallback: string, locale: Locale): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? fallback;
  } catch {
    return fallback;
  }
}

const TEXT = {
  fr: {
    pricesFor: "Vos prix pour",
    billed: (currency: string) => `Facturé en ${currency}, par mois, sans engagement.`,
    shownPlan: "Formule affichée",
    trial: (days: number) => `${days} jours offerts`,
    everything: (name: string) => `Tout ce que contient la formule ${name}`,
    extraSeat: (price: string, soon: boolean) => ` · utilisateur supplémentaire ${price}/mois${soon ? " (bientôt)" : ""}`,
    cta: "Commencer gratuitement",
    ctaNote: (days: number, name: string) =>
      `${days} jours de formule ${name} offerts à l'inscription, sans carte bancaire. Vous changez de formule quand vous voulez, et vos données restent les vôtres.`,
    perMonth: "/ mois",
    ctaFree: "Commencer gratuitement",
    ctaTrial: "Essayer 14 jours",
    ctaPlan: (name: string) => `Choisir ${name}`,
    more: (count: number) => `Tout le détail (${count} de plus)`,
    less: "Replier le détail",
  },
  en: {
    pricesFor: "Your prices for",
    billed: (currency: string) => `Billed in ${currency}, monthly, no commitment.`,
    shownPlan: "Plan shown",
    trial: (days: number) => `${days} days free`,
    everything: (name: string) => `Everything in the ${name} plan`,
    extraSeat: (price: string, soon: boolean) => ` · extra user ${price}/month${soon ? " (soon)" : ""}`,
    cta: "Start for free",
    ctaNote: (days: number, name: string) =>
      `${days} days of the ${name} plan free when you sign up, no credit card. Change plans whenever you like; your data stays yours.`,
    perMonth: "/ month",
    ctaFree: "Start for free",
    ctaTrial: "Try it for 14 days",
    ctaPlan: (name: string) => `Choose ${name}`,
    more: (count: number) => `Full details (${count} more)`,
    less: "Hide the details",
  },
} satisfies Record<Locale, unknown>;

export function PlanLadder({ locale = "fr" }: { locale?: Locale }) {
  const t = TEXT[locale];
  const content = landingText(locale);
  const selectId = useId();
  const detectedCountry = useSyncExternalStore(
    NO_SUBSCRIBE,
    getDetectedCountry,
    getServerCountry,
  );
  // null until the visitor picks a country themselves, so detection keeps working on first
  // paint and is then overridden for good once they choose.
  const [chosenCountry, setChosenCountry] = useState<string | null>(null);
  const countryCode = chosenCountry ?? detectedCountry;

  const currency = currencyForCountry(countryCode);
  const format = CURRENCY_FORMAT[currency];

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <label htmlFor={selectId} className="text-sm text-ink-soft">
          {t.pricesFor}
        </label>
        <select
          id={selectId}
          value={countryCode}
          onChange={(event) => setChosenCountry(event.target.value)}
          className="rounded-md border border-rule bg-paper px-3 py-1.5 text-sm font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
        >
          {BILLABLE_COUNTRIES.map((country) => (
            <option key={country.code} value={country.code}>
              {countryName(country.code, country.label, locale)}
            </option>
          ))}
        </select>
        <p className="text-sm text-ink-soft">
          {t.billed(currency)}
        </p>
      </div>

      {/* Four cards side by side (two on a tablet, one under the other on a phone): the price,
          who it is for, its five strongest lines and one button each — the full list folds away
          under "Tout le détail". The long ruled ladder this replaces was a wall of ticks nobody
          could compare. */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PLAN_KEYS.map((plan) => {
          const price = PLAN_PRICES[currency][plan];
          const isEntry = plan === "free";
          const highlighted = plan === SIGNUP_TRIAL.plan;
          const ai = aiLine(plan, locale);
          const lines: { text: string; strong?: boolean }[] = [
            ...(isEntry
              ? []
              : [{ text: t.everything(PLAN_NAMES[PLAN_KEYS[PLAN_KEYS.indexOf(plan) - 1]!]), strong: true }]),
            ...modulesGainedAt(plan).map((module) => ({ text: content.modulePromises[module] })),
            ...[...featuresGainedAt(plan, locale), ...(content.planPerks[plan] ?? [])].map((text) => ({ text })),
            {
              text:
                seatLine(plan, locale) +
                (isEntry ? "" : t.extraSeat(format.display(EXTRA_SEAT_PRICES[currency]), !EXTRA_SEAT_PURCHASABLE)),
            },
            ...quotaLines(plan, locale).map((text) => ({ text })),
            ...paymentLines(plan, locale).map((text) => ({ text })),
            ...(ai ? [{ text: ai }] : []),
          ];
          const highlights = lines.slice(0, 5);
          const rest = lines.slice(5);

          return (
            <article
              key={plan}
              className={`flex flex-col rounded-2xl border p-5 ${
                highlighted ? "border-primary bg-paper shadow-lg shadow-ink/10 ring-1 ring-primary" : "border-rule bg-paper"
              }`}
            >
              <h3 className="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-tight text-ink">
                {PLAN_NAMES[plan]}
                {highlighted && (
                  <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-on-primary">
                    {t.trial(SIGNUP_TRIAL.days)}
                  </span>
                )}
              </h3>
              {/* Mono: the four prices line up across the cards. */}
              <p className="mt-2 font-mono text-3xl tabular-nums text-ink">
                {format.display(isEntry ? 0 : price)}
                <span className="ml-1 font-sans text-sm text-ink-soft">{t.perMonth}</span>
              </p>
              <p className="mt-1.5 min-h-10 text-sm leading-snug text-ink-soft">{content.planAudience[plan]}</p>
              <Link
                href={locale === "en" ? "/register?lang=en" : "/register"}
                className={`mt-4 inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 ${
                  highlighted
                    ? "bg-primary text-on-primary hover:bg-primary-hover"
                    : "border border-ink/20 text-ink hover:border-ink"
                }`}
              >
                {isEntry ? t.ctaFree : highlighted ? t.ctaTrial : t.ctaPlan(PLAN_NAMES[plan])}
              </Link>
              <ul className="mt-5 space-y-2 border-t border-rule pt-4">
                {highlights.map((line) => (
                  <li key={line.text} className={`flex gap-2.5 text-sm leading-snug ${line.strong ? "font-semibold text-ink" : "text-ink"}`}>
                    <span aria-hidden="true" className="mt-px select-none text-success">✓</span>
                    {line.text}
                  </li>
                ))}
              </ul>
              {rest.length > 0 && (
                <details className="group mt-3">
                  <summary className="cursor-pointer list-none text-sm font-medium text-ink-soft underline-offset-4 hover:text-ink hover:underline [&::-webkit-details-marker]:hidden">
                    <span className="group-open:hidden">{t.more(rest.length)}</span>
                    <span className="hidden group-open:inline">{t.less}</span>
                  </summary>
                  <ul className="mt-2 space-y-2">
                    {rest.map((line) => (
                      <li key={line.text} className="flex gap-2.5 text-sm leading-snug text-ink">
                        <span aria-hidden="true" className="mt-px select-none text-ink-soft">✓</span>
                        {line.text}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </article>
          );
        })}
      </div>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Link
          href={locale === "en" ? "/register?lang=en" : "/register"}
          className="inline-flex shrink-0 items-center justify-center rounded-lg bg-primary px-5 py-2.5 font-semibold text-on-primary transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
        >
          {t.cta}
        </Link>
        <p className="text-sm text-ink-soft">{t.ctaNote(SIGNUP_TRIAL.days, PLAN_NAMES[SIGNUP_TRIAL.plan])}</p>
      </div>
    </div>
  );
}
