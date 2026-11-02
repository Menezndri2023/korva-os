"use client";

import Link from "next/link";
import { PLAN_FEATURE_LABELS, PLAN_FEATURE_LABELS_EN, type PlanFeature } from "@korva/types";
import { Card } from "@korva/ui";
import { featurePlanName } from "@/lib/use-plan-features";
import { useDashboardLocale, useT } from "@/lib/dashboard-locale";

/**
 * In place of a tool the plan does not include: what it does and where to get it — never a dead
 * screen of locked controls.
 */
export function UpgradeCard({ feature, description }: { feature: PlanFeature; description: string }) {
  const plan = featurePlanName(feature);
  const locale = useDashboardLocale();
  const t = useT();
  return (
    <Card className="flex flex-col gap-3 border-dashed p-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-text">
          {locale === "en" ? PLAN_FEATURE_LABELS_EN[feature] : PLAN_FEATURE_LABELS[feature]}
          <span className="ml-2 rounded-full bg-action-soft px-2 py-0.5 text-xs font-semibold text-action">
            {t(`Formule ${plan}`, `${plan} plan`)}
          </span>
        </p>
        <p className="mt-1 text-sm text-text-muted">{description}</p>
      </div>
      <Link
        href="/dashboard/settings#abonnement"
        className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-action px-4 text-sm font-semibold text-on-action hover:bg-action-hover"
      >
        {t(`Passer à ${plan}`, `Move to ${plan}`)}
      </Link>
    </Card>
  );
}
