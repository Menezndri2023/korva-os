export const AI_AGENTS = [
  "general_assistant",
  "sales_agent",
  "booking_agent",
  "analytics_agent",
] as const;
export type AiAgent = (typeof AI_AGENTS)[number];

export const AI_MESSAGE_ROLES = ["user", "assistant", "tool"] as const;
export type AiMessageRole = (typeof AI_MESSAGE_ROLES)[number];

export interface AiToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** Opaque provider data required back on the next turn (Gemini's thought signature). */
  providerData?: Record<string, unknown>;
}

export interface AiConversation {
  id: string;
  organizationId: string;
  userId: string;
  agent: AiAgent;
  title?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiMessage {
  id: string;
  organizationId: string;
  conversationId: string;
  role: AiMessageRole;
  content?: string;
  toolCalls?: AiToolCall[];
  toolCallId?: string;
  toolName?: string;
  createdAt: string;
}

export const AI_PENDING_ACTION_STATUSES = [
  "pending",
  "confirming",
  "confirmed",
  "rejected",
] as const;
export type AiPendingActionStatus = (typeof AI_PENDING_ACTION_STATUSES)[number];

/** A tool call the orchestrator deferred for explicit human confirmation (see docs/ai.md). */
export interface AiPendingAction {
  id: string;
  organizationId: string;
  conversationId: string;
  toolName: string;
  input: Record<string, unknown>;
  status: AiPendingActionStatus;
  confirmedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiChatResponse {
  conversationId: string;
  reply: string;
  pendingActions: AiPendingAction[];
}

/**
 * One row per real model call (not per user turn — a single chat turn can make several, one per
 * tool-calling iteration). `costUsd` is null when the model string isn't in this codebase's known
 * pricing table (see apps/api/src/ai/ai-pricing.util.ts) — never a guessed/wrong figure.
 */
export interface AiUsageLog {
  id: string;
  organizationId: string;
  conversationId: string;
  agent: AiAgent;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  createdAt: string;
}

/** Aggregated over the current billing period ("YYYY-MM", same period shape EntitlementsService
 *  already uses for `ai_messages_per_month`) — see GET /ai/usage-summary. */
export interface AiUsageSummary {
  period: string;
  inputTokens: number;
  outputTokens: number;
  /** Sum of every logged row's costUsd — null rows (unrecognized model) contribute 0 to this
   *  total but are counted separately in `unpricedCalls` so the total is never silently wrong
   *  without at least flagging that some calls couldn't be priced. */
  costUsd: number;
  unpricedCalls: number;
}
