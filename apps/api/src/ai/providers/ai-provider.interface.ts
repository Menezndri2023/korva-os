export const AI_PROVIDER = Symbol('AI_PROVIDER');

export interface AiChatToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type AiChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }
  | { role: 'assistant'; toolCalls: AiChatToolCall[] }
  | { role: 'tool'; toolCallId: string; toolName: string; content: string };

/** Present whenever a real LLM API call actually happened (the Anthropic provider always sets
 *  it); absent for a provider that never calls a real paid API (NullAIProvider, test doubles) —
 *  AiOrchestratorService treats a missing `usage` as "nothing to log," never as zero usage. */
export interface AiChatUsage {
  inputTokens: number;
  outputTokens: number;
}

export type AiChatResult =
  | { type: 'text'; text: string; usage?: AiChatUsage }
  | { type: 'tool_calls'; toolCalls: AiChatToolCall[]; usage?: AiChatUsage };

export interface AiToolDefinition {
  name: string;
  description: string;
  /** JSON Schema describing the tool's input, sent as-is to the LLM provider. */
  inputSchema: Record<string, unknown>;
}

/**
 * Business logic must never talk to an LLM API directly — only through this interface,
 * injected via the AI_PROVIDER token. The orchestrator drives a tool-calling loop against
 * this abstraction; swapping providers (or models) never touches AiOrchestratorService.
 */
export interface AIProvider {
  readonly name: string;
  /** The real model string calls are actually billed against (e.g. "claude-sonnet-5") — absent
   *  for a provider with no real per-call cost (NullAIProvider, test doubles). Read by
   *  AiOrchestratorService purely for usage-log attribution; never used to route a request. */
  readonly model?: string;
  chat(input: {
    systemPrompt: string;
    messages: AiChatMessage[];
    tools: AiToolDefinition[];
  }): Promise<AiChatResult>;
}
