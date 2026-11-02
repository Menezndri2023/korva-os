import type { Translate } from '../../shared/i18n';
import type {
  ActionCenterSeverity,
  RecommendationEntityType,
  SystemEvent,
} from '@korva/types';

export interface RecommendationDraft {
  entityType: RecommendationEntityType;
  entityId: string;
  title: string;
  description: string;
  severity: ActionCenterSeverity;
  /** Grounded in real data the rule already read from the event payload — never invented. */
  impact?: string;
  /** Deterministic rules (the condition either matched or it didn't) should normally leave this
   *  unset rather than report a synthetic 100% — reserved for a future probabilistic rule. */
  confidence?: number;
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
  /** `t` writes the recommendation in the business's language (shared/i18n.ts). */
  evaluate(
    organizationId: string,
    payload: Record<string, unknown>,
    t: Translate,
  ): Promise<RecommendationDraft | null>;
}
