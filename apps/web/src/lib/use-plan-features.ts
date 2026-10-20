import { useQuery } from "@tanstack/react-query";
import {
  PLAN_FEATURE_MIN_PLAN,
  PLAN_NAMES,
  planHasFeature,
  type PlanFeature,
  type SubscriptionSummary,
} from "@korva/types";
import { apiClient } from "./api-client";
import { useAuthReady } from "./use-auth-ready";

/**
 * Which paid features the active organization's plan includes (PLAN_FEATURE_MIN_PLAN), for
 * locking the matching controls. Shares the ["subscriptions", "me"] cache with Settings.
 *
 * While the plan is unknown (loading, or a failed request) every feature reads as INCLUDED: a
 * control briefly shown and then refused by the API is better than a paying customer seeing a
 * lock on what they paid for. The API enforces each feature either way.
 */
export function usePlanFeatures() {
  const authReady = useAuthReady();
  const { data } = useQuery({
    queryKey: ["subscriptions", "me"],
    queryFn: () => apiClient.get<SubscriptionSummary>("/subscriptions/me"),
    enabled: authReady,
  });
  // Optional chaining on `plan` too: a malformed or partial response must not take a page down.
  const planKey = data?.plan?.key;
  return {
    planKey,
    has: (feature: PlanFeature) => !planKey || planHasFeature(planKey, feature),
  };
}

/** "Starter", "Pro"... — the tier that unlocks a feature, for its lock label. */
export function featurePlanName(feature: PlanFeature): string {
  return PLAN_NAMES[PLAN_FEATURE_MIN_PLAN[feature]];
}
