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

export type AiChatResult =
  | { type: 'text'; text: string }
  | { type: 'tool_calls'; toolCalls: AiChatToolCall[] };

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
  chat(input: {
    systemPrompt: string;
    messages: AiChatMessage[];
    tools: AiToolDefinition[];
  }): Promise<AiChatResult>;
}
