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
