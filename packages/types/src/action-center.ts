export const ACTION_CENTER_ITEM_TYPES = [
  "recommendation",
  "pending_approval",
  "workflow_failure",
] as const;
export type ActionCenterItemType = (typeof ACTION_CENTER_ITEM_TYPES)[number];

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
}

/** The four tiles from the Business OS brief's own Action Center example (§17). */
export interface ActionCenterSummary {
  pendingApprovals: number;
  recommendations: number;
  automatedThisWeek: number;
  failures: number;
}
