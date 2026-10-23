import { Logger } from '@nestjs/common';
import type {
  AIProvider,
  AiChatMessage,
  AiChatResult,
  AiChatToolCall,
  AiToolDefinition,
} from './ai-provider.interface';

/** The provider is saturated or rate-limited (a free tier's per-minute cap, most often).
 *  AiOrchestratorService turns it into a calm "réessayez dans une minute" instead of an error. */
export class AiProviderBusyError extends Error {}

const MAX_RETRIES = 2;
/** Past this, the business is told to come back in a minute rather than left waiting. */
const MAX_RETRY_WAIT_MS = 10_000;

/** How long the provider asks to wait (Retry-After header, or Gemini's "retryDelay": "7s" in the
 *  body), clamped to at least 1 s; null when it asks for longer than MAX_RETRY_WAIT_MS. */
export function retryWaitMs(headers: Headers, body: string): number | null {
  const header = Number(headers.get('retry-after'));
  const fromBody = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body)?.[1];
  const seconds =
    Number.isFinite(header) && header > 0
      ? header
      : fromBody
        ? Number(fromBody)
        : 3;
  const ms = Math.max(1_000, Math.ceil(seconds * 1000));
  return ms > MAX_RETRY_WAIT_MS ? null : ms;
}

interface ChatCompletionToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
  /** Gemini: { google: { thought_signature } } — must be sent back unchanged. */
  extra_content?: Record<string, unknown>;
}
interface ChatCompletionResponse {
  choices?: {
    finish_reason?: string;
    message?: {
      content?: string | null;
      tool_calls?: ChatCompletionToolCall[];
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function toChatCompletionMessages(
  systemPrompt: string,
  messages: AiChatMessage[],
): unknown[] {
  return [
    { role: 'system', content: systemPrompt },
    ...messages.map((message) => {
      if (message.role === 'user')
        return { role: 'user', content: message.content };
      if (message.role === 'assistant' && 'toolCalls' in message) {
        return {
          role: 'assistant',
          content: null,
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: 'function',
            function: {
              name: call.name,
              arguments: JSON.stringify(call.input ?? {}),
            },
            ...(call.providerData?.extra_content
              ? { extra_content: call.providerData.extra_content }
              : {}),
          })),
        };
      }
      if (message.role === 'assistant')
        return { role: 'assistant', content: message.content };
      return {
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: message.content,
      };
    }),
  ];
}

/** Some models return slightly malformed JSON arguments; an unparseable call is passed on as
 *  `{}`, and the tool's own input validation then explains what is missing to the model. */
function parseArguments(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw || '{}');
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * One client for every model served through the OpenAI "chat completions" format — Groq,
 * Mistral, OpenRouter, Google Gemini's compatible endpoint, a model KORVA hosts with Ollama… See
 * korva-ai.config.ts for how one is chosen. Business logic never sees which one answers.
 */
export class OpenAiCompatibleAIProvider implements AIProvider {
  readonly name = 'openai_compatible';
  private readonly logger = new Logger(OpenAiCompatibleAIProvider.name);

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    readonly model: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  async chat(input: {
    systemPrompt: string;
    messages: AiChatMessage[];
    tools: AiToolDefinition[];
  }): Promise<AiChatResult> {
    const send = () =>
      this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1024,
          messages: toChatCompletionMessages(
            input.systemPrompt,
            input.messages,
          ),
          ...(input.tools.length > 0
            ? {
                tools: input.tools.map((tool) => ({
                  type: 'function',
                  function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.inputSchema,
                  },
                })),
                tool_choice: 'auto',
              }
            : {}),
        }),
        signal: AbortSignal.timeout(60_000),
      });

    // A free tier allows a few calls a minute for the whole platform (Gemini: 15 per model per
    // minute), so short bursts are common: wait what the provider asks, up to MAX_RETRY_WAIT_MS,
    // and try again before telling the business it is busy.
    let response = await send();
    for (
      let retry = 0;
      retry < MAX_RETRIES && response.status === 429;
      retry++
    ) {
      const wait = retryWaitMs(response.headers, await response.clone().text());
      if (wait === null) break;
      await this.sleep(wait);
      response = await send();
    }

    if (!response.ok) {
      // The body may echo the request; it never contains the key, but keep the log short.
      const body = (await response.text()).slice(0, 300);
      this.logger.error(
        `AI provider responded with ${response.status}: ${body}`,
      );
      if (response.status === 429 || response.status === 503) {
        throw new AiProviderBusyError(`AI provider busy (${response.status})`);
      }
      throw new Error(`AI provider responded with status ${response.status}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const message = data.choices?.[0]?.message;
    const usage =
      data.usage?.prompt_tokens !== undefined
        ? {
            inputTokens: data.usage.prompt_tokens,
            outputTokens: data.usage.completion_tokens ?? 0,
          }
        : undefined;

    if (message?.tool_calls && message.tool_calls.length > 0) {
      const toolCalls: AiChatToolCall[] = message.tool_calls.map(
        (call, index) => ({
          id: call.id || `call_${index}`,
          name: call.function.name,
          input: parseArguments(call.function.arguments),
          ...(call.extra_content
            ? { providerData: { extra_content: call.extra_content } }
            : {}),
        }),
      );
      return { type: 'tool_calls', toolCalls, usage };
    }
    return { type: 'text', text: message?.content?.trim() ?? '', usage };
  }
}
