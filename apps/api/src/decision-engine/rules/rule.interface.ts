import type { RecommendationEntityType, SystemEvent } from '@korva/types';

export interface RecommendationDraft {
  entityType: RecommendationEntityType;
  entityId: string;
  title: string;
  description: string;
}

/**
 * A single deterministic Decision Engine rule (docs/BUSINESS_OS_AUDIT.md §9, item #3) — "RÈGLES
 * MÉTIER + DONNÉES + ÉVÉNEMENTS", never an LLM standing in for a business decision (see the
 * Business OS brief's own §7). Each rule reacts to exactly one system event; DecisionEngineService
 * dispatches every incoming event to whichever rules declare that `eventName`. `evaluate` returns
 * `null` when, given this specific event instance, the rule doesn't actually want to recommend
 * anything (e.g. a future rule might decide the amount is too small to bother a human with) —
 * returning null is a normal outcome, not an error.
 */
export interface DecisionRule {
  /** Stored as Recommendation.ruleKey — stable, never reused by another rule. */
  readonly key: string;
  readonly eventName: SystemEvent;
  evaluate(
    organizationId: string,
    payload: Record<string, unknown>,
  ): Promise<RecommendationDraft | null>;
}
