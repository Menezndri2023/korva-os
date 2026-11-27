"use client";

import { useState } from "react";
import {
  PLAN_INTERVAL_LABELS,
  PLAN_INTERVAL_MONTHS,
  PLAN_INTERVAL_ORDER,
  PLAN_INTERVAL_PER,
  normalizePlanInterval,
  type Locale,
  type Plan,
  type PlanInterval,
} from "@korva/types";
import { Button } from "@korva/ui";
import { formatCurrency } from "@/lib/analytics-format";

/**
 * Settings > Abonnement: pick a plan AND how long to pay for — 1 month, 6 months (-10 %) or a
 * year (2 months free). Prices are the ones GET /plans returns, never recomputed here, so the
 * screen shows exactly what the invoice will say; the saving is measured against the same tier's
 * own monthly price in that list.
 *
 * Free exists monthly only, so it shows under every duration: choosing it is never blocked.
 */
export function PlanPicker({
  plans,
  currentPlanId,
  onChoose,
  pending,
  locale,
}: {
  plans: Plan[];
  currentPlanId: string;
  onChoose: (planKey: string, interval: PlanInterval) => void;
  pending: boolean;
  locale: Locale;
}) {
  const en = locale === "en";
  const current = plans.find((plan) => plan.id === currentPlanId);
  const [interval, setChosenInterval] = useState<PlanInterval>(normalizePlanInterval(current?.interval));

  const monthlyPrice = (key: string) =>
    plans.find((plan) => plan.key === key && normalizePlanInterval(plan.interval) === "month")?.priceAmount;
  const shown = plans.filter((plan) => {
    const planInterval = normalizePlanInterval(plan.interval);
    return planInterval === interval || (plan.priceAmount <= 0 && planInterval === "month");
  });
  const offered = PLAN_INTERVAL_ORDER.filter((candidate) =>
    plans.some((plan) => normalizePlanInterval(plan.interval) === candidate && plan.priceAmount > 0),
  );

  return (
    <div className="space-y-3 border-t border-border pt-4">
      {offered.length > 1 && (
        <div role="radiogroup" aria-label={en ? "Billing period" : "Durée de paiement"} className="flex flex-wrap gap-2">
          {offered.map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="radio"
              aria-checked={candidate === interval}
              onClick={() => setChosenInterval(candidate)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                candidate === interval ? "border-sidebar bg-sidebar text-white" : "border-border text-text-muted hover:text-text"
              }`}
            >
              {PLAN_INTERVAL_LABELS[locale][candidate]}
              {candidate === "half_year" && <span className="ml-1 opacity-80">−10 %</span>}
              {candidate === "year" && <span className="ml-1 opacity-80">{en ? "2 months free" : "2 mois offerts"}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {shown.map((plan) => {
          const planInterval = normalizePlanInterval(plan.interval);
          const months = PLAN_INTERVAL_MONTHS[planInterval];
          const monthly = monthlyPrice(plan.key);
          const saving = months > 1 && monthly !== undefined ? monthly * months - plan.priceAmount : 0;
          const isCurrent = plan.id === currentPlanId;
          return (
            <div key={plan.id} className="rounded-md border border-border p-3 text-xs">
              <p className="font-medium">{plan.name}</p>
              <p className="mt-0.5 text-text-muted">
                {formatCurrency(plan.priceAmount, plan.priceCurrency, locale)} {PLAN_INTERVAL_PER[locale][planInterval]}
              </p>
              {months > 1 && plan.priceAmount > 0 && (
                <p className="mt-0.5 text-text-muted">
                  {en ? "i.e. " : "soit "}
                  {formatCurrency(Math.round(plan.priceAmount / months), plan.priceCurrency, locale)}{" "}
                  {PLAN_INTERVAL_PER[locale].month}
                  {saving > 0 && (
                    <span className="block font-medium text-success">
                      {en ? "You save " : "Vous économisez "}
                      {formatCurrency(saving, plan.priceCurrency, locale)}
                    </span>
                  )}
                </p>
              )}
              <Button
                variant="secondary"
                size="sm"
                className="mt-2 w-full disabled:cursor-default"
                onClick={() => onChoose(plan.key, planInterval)}
                disabled={isCurrent || pending}
              >
                {isCurrent ? (en ? "Current plan" : "Plan actuel") : en ? "Choose" : "Choisir"}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
