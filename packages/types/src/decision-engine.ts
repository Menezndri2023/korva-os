export const RECOMMENDATION_STATUSES = ["open", "dismissed", "resolved"] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

/**
 * What business entity this recommendation is about — always resolvable back into the
 * Business Graph (see business-graph.ts) via `entityType`/`entityId`.
 */
export const RECOMMENDATION_ENTITY_TYPES = ["invoice", "contact"] as const;
export type RecommendationEntityType =
  (typeof RECOMMENDATION_ENTITY_TYPES)[number];

/**
 * A Decision Engine rule identifier — not a closed enum on purpose, so new rules never need a
 * schema/type migration to ship. `invoice_overdue_followup` and `customer_reactivation` are the
 * two rules Decision Engine v1 ships with (docs/BUSINESS_OS_AUDIT.md §9, item #3).
 */
export type RecommendationRuleKey = string;

export interface Recommendation {
  id: string;
  organizationId: string;
  ruleKey: RecommendationRuleKey;
  title: string;
  description: string;
  entityType: RecommendationEntityType;
  entityId: string;
  status: RecommendationStatus;
  createdAt: string;
  updatedAt: string;
}
