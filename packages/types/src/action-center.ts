export const ACTION_CENTER_ITEM_TYPES = [
  "recommendation",
  "pending_approval",
  "workflow_failure",
  "webhook_delivery_failure",
] as const;
export type ActionCenterItemType = (typeof ACTION_CENTER_ITEM_TYPES)[number];

/**
 * Ordered from most to least pressing — the Action Center feed groups by this order rather than
 * showing one flat list. "urgent" = time-sensitive/customer-facing risk (an overdue invoice, a
 * depleted product, a stuck AI approval). "attention" = should be looked at soon but isn't
 * actively bleeding revenue (a low-stock warning, a failed automation). "opportunity" = no risk,
 * but acting on it could grow revenue (a customer worth re-engaging). "recommendation" = the
 * default/lowest tier, used for AI-drafted suggestions (see RecommendationsService.propose) that
 * haven't been triaged into a more specific bucket by a human or a deterministic rule.
 */
export const ACTION_CENTER_SEVERITIES = [
  "urgent",
  "attention",
  "opportunity",
  "recommendation",
] as const;
export type ActionCenterSeverity = (typeof ACTION_CENTER_SEVERITIES)[number];

/**
 * One normalized entry in the Action Center feed — a projection over Recommendation (Decision
 * Engine), AiPendingAction (AI tool-call confirmations), and WorkflowExecution (failed
 * automation runs), the same way BusinessGraphTimelineEntry projects over business documents
 * for one contact. Nothing here is stored independently.
 */
export interface ActionCenterItem {
  type: ActionCenterItemType;
  id: string;
  title: string;
  description?: string;
  occurredAt: string;
  entityType?: string;
  entityId?: string;
  severity: ActionCenterSeverity;
  /** Free-text, grounded in real data already available to the producer (e.g. an outstanding
   *  amount, a days-inactive count) — never an invented/estimated figure. */
  impact?: string;
  /** Meaningful only for probabilistic/AI-authored items — a deterministic Decision Engine rule
   *  (either the condition is met or it isn't) typically leaves this unset rather than reporting
   *  a synthetic 100%. */
  confidence?: number;
}

/** The four tiles from the Business OS brief's own Action Center example (§17). */
export interface ActionCenterSummary {
  pendingApprovals: number;
  recommendations: number;
  automatedThisWeek: number;
  failures: number;
}
