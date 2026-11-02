"use client";

import type { PlanFeature } from "@korva/types";
import { Badge } from "@korva/ui";
import { featurePlanName } from "@/lib/use-plan-features";
import { useT } from "@/lib/dashboard-locale";

/** The small "🔒 Starter" badge next to a control the current plan does not include. */
export function PlanLock({ feature }: { feature: PlanFeature }) {
  const t = useT();
  const plan = featurePlanName(feature);
  return <Badge>🔒 {t(`Formule ${plan}`, `${plan} plan`)}</Badge>;
}
