import type { PlanFeature } from "@korva/types";
import { Badge } from "@korva/ui";
import { featurePlanName } from "@/lib/use-plan-features";

/** The small "🔒 Starter" badge next to a control the current plan does not include. */
export function PlanLock({ feature }: { feature: PlanFeature }) {
  return <Badge>🔒 Formule {featurePlanName(feature)}</Badge>;
}
