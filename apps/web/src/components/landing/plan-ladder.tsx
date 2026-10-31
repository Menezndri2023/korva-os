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
  PLAN_FEATURE_MIN_PLAN,
  PLAN_PRICES,
  commissionPercentLabel,
  SIGNUP_TRIAL,
  countryFromTimeZone,
  currencyForCountry,
  type PlanFeature,
  type PlanKey,
} from "@korva/types";
import { MODULE_PROMISES, PLAN_AUDIENCE, PLAN_PERKS } from "@/lib/landing-content";

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
function featuresGainedAt(plan: PlanKey): string[] {
  return (Object.keys(PLAN_FEATURE_MIN_PLAN) as PlanFeature[])
    .filter((feature) => PLAN_FEATURE_MIN_PLAN[feature] === plan)
    .map((feature) => PLAN_FEATURE_LABELS[feature]);
}

/** The modules whose threshold IS this tier — i.e. what you gain by moving up to it. */
function modulesGainedAt(plan: PlanKey) {
  return KORVA_MODULES.filter((module) => MODULE_MIN_PLAN[module] === plan);
}

/** "Utilisateurs" are dashboard logins — bookable staff (coiffeurs, coachs) are a separate,
 *  much larger allowance, which is the point of keeping the two words apart. */
function seatLine(plan: PlanKey): string {
  const seats = PLAN_LIMITS[plan].seats;
  if (seats === -1) return "Utilisateurs illimités";
  return seats === 1 ? "1 utilisateur du tableau de bord" : `${seats} utilisateurs du tableau de bord`;
}

/** The counted quotas, each enforced by EntitlementsService.assertCountWithinLimit. */
function quotaLines(plan: PlanKey): string[] {
  const { offers, bookable_staff: staff, workflows } = PLAN_LIMITS[plan];
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

function aiLine(plan: PlanKey): string | null {
  const quota = PLAN_LIMITS[plan].ai_messages_per_month;
  if (!quota || quota === 0) return null;
  if (quota === -1) return "KORVA IA sans limite";
  return `KORVA IA : ${quota.toLocaleString("fr-FR")} messages par mois`;
}

/** Le Solde KORVA: the commission on online sales and how withdrawals work, from the same
 *  tables WalletService applies (PLAN_COMMISSION_BASIS_POINTS, PLAN_PAYOUT_RULES). */
function paymentLines(plan: PlanKey): string[] {
  const rules = PLAN_PAYOUT_RULES[plan];
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

export function PlanLadder() {
  const selectId = useId();
  const detectedCountry = useSyncExternalStore(
    NO_SUBSCRIBE,
    getDetectedCountry,
    getServerCountry,
  );
  // null until the visitor picks a country themselves, so detection keeps working on first
  // paint and is then overridden for good once they choose.
  const [chosenCountry, setChosenCountry] = useState<string | null>(null);
  // Phones show one plan at a time: the four full lists made this section alone some 3,000px
  // of scrolling. From sm: all four stay visible, as a ladder to compare.
  const [mobilePlan, setMobilePlan] = useState<PlanKey>(SIGNUP_TRIAL.plan);
  const countryCode = chosenCountry ?? detectedCountry;

  const currency = currencyForCountry(countryCode);
  const format = CURRENCY_FORMAT[currency];

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <label htmlFor={selectId} className="text-sm text-ink-soft">
          Vos prix pour
        </label>
        <select
          id={selectId}
          value={countryCode}
          onChange={(event) => setChosenCountry(event.target.value)}
          className="rounded-md border border-rule bg-paper px-3 py-1.5 text-sm font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
        >
          {BILLABLE_COUNTRIES.map((country) => (
            <option key={country.code} value={country.code}>
              {country.label}
            </option>
          ))}
        </select>
        <p className="text-sm text-ink-soft">
          Facturé en {currency}, par mois, sans engagement.
        </p>
      </div>

      <div role="group" aria-label="Formule affichée" className="mt-6 grid grid-cols-4 gap-1 rounded-xl bg-paper-shade p-1 sm:hidden">
        {PLAN_KEYS.map((plan) => (
          <button
            key={plan}
            type="button"
            aria-pressed={plan === mobilePlan}
            onClick={() => setMobilePlan(plan)}
            className={`rounded-lg px-1 py-2 text-sm font-medium transition-colors ${
              plan === mobilePlan ? "bg-ink text-paper shadow" : "text-ink-soft"
            }`}
          >
            {PLAN_NAMES[plan]}
          </button>
        ))}
      </div>

      <div className="mt-4 divide-y divide-rule border-t border-ink sm:mt-8">
        {PLAN_KEYS.map((plan) => {
          const price = PLAN_PRICES[currency][plan];
          const gained = modulesGainedAt(plan);
          const ai = aiLine(plan);
          const isEntry = plan === "free";
          const quotas = quotaLines(plan);

          return (
            <div
              key={plan}
              className={`gap-3 py-6 sm:grid sm:grid-cols-[15rem_1fr] sm:gap-10 ${
                plan === mobilePlan ? "grid" : "hidden"
              }`}
            >
              <div>
                <h3 className="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-tight text-ink">
                  {PLAN_NAMES[plan]}
                  {plan === SIGNUP_TRIAL.plan && (
                    <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-on-primary">
                      {SIGNUP_TRIAL.days} jours offerts
                    </span>
                  )}
                </h3>
                {/* Mono, and this is the one place it is used: the four prices form a column
                    that has to line up, and proportional digits do not. */}
                <p className="mt-1 font-mono text-2xl tabular-nums text-ink">
                  {isEntry ? "0" : format.display(price)}
                  {isEntry && <span className="ml-1.5 font-sans text-base">{currency}</span>}
                </p>
                <p className="mt-1.5 text-sm leading-snug text-ink-soft">
                  {PLAN_AUDIENCE[plan]}
                </p>
              </div>

              <ul className="grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
                {!isEntry && (
                  <li className="flex gap-2.5 text-[0.9375rem] font-medium leading-snug text-ink sm:col-span-2">
                    <span aria-hidden="true" className="mt-px select-none text-ink-soft">
                      ✓
                    </span>
                    Tout ce que contient la formule{" "}
                    {PLAN_NAMES[PLAN_KEYS[PLAN_KEYS.indexOf(plan) - 1]!]}
                  </li>
                )}
                {gained.map((module) => (
                  <li key={module} className="flex gap-2.5 text-[0.9375rem] leading-snug text-ink">
                    <span aria-hidden="true" className="mt-px select-none text-ink-soft">
                      ✓
                    </span>
                    {MODULE_PROMISES[module]}
                  </li>
                ))}
                {[...featuresGainedAt(plan), ...(PLAN_PERKS[plan] ?? [])].map((perk) => (
                  <li key={perk} className="flex gap-2.5 text-[0.9375rem] leading-snug text-ink">
                    <span aria-hidden="true" className="mt-px select-none text-ink-soft">
                      ✓
                    </span>
                    {perk}
                  </li>
                ))}
                <li className="flex gap-2.5 text-[0.9375rem] leading-snug text-ink">
                  <span aria-hidden="true" className="mt-px select-none text-ink-soft">
                    ✓
                  </span>
                  {/* One span: as direct flex children, the seat count and the extra-seat price
                      became two columns squeezed side by side. */}
                  <span>
                    {seatLine(plan)}
                    {!isEntry && (
                      <span className="text-ink-soft">
                        {" "}
                        · utilisateur supplémentaire {format.display(EXTRA_SEAT_PRICES[currency])}
                        /mois{EXTRA_SEAT_PURCHASABLE ? "" : " (bientôt)"}
                      </span>
                    )}
                  </span>
                </li>
                {quotas.map((line) => (
                  <li key={line} className="flex gap-2.5 text-[0.9375rem] leading-snug text-ink">
                    <span aria-hidden="true" className="mt-px select-none text-ink-soft">
                      ✓
                    </span>
                    {line}
                  </li>
                ))}
                {paymentLines(plan).map((line) => (
                  <li key={line} className="flex gap-2.5 text-[0.9375rem] leading-snug text-ink">
                    <span aria-hidden="true" className="mt-px select-none text-ink-soft">
                      ✓
                    </span>
                    {line}
                  </li>
                ))}
                {ai && (
                  <li className="flex gap-2.5 text-[0.9375rem] leading-snug text-ink">
                    <span aria-hidden="true" className="mt-px select-none text-ink-soft">
                      ✓
                    </span>
                    {ai}
                  </li>
                )}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Link
          href="/register"
          className="inline-flex shrink-0 items-center justify-center rounded-lg bg-primary px-5 py-2.5 font-semibold text-on-primary transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
        >
          Commencer gratuitement
        </Link>
        <p className="text-sm text-ink-soft">
          {SIGNUP_TRIAL.days} jours de formule {PLAN_NAMES[SIGNUP_TRIAL.plan]} offerts à
          l&apos;inscription, sans carte bancaire. Vous changez de formule quand vous voulez, et vos
          données restent les vôtres.
        </p>
      </div>
    </div>
  );
}
