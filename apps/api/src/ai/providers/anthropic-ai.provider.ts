import { Logger } from '@nestjs/common';
import type {
  AIProvider,
  AiChatMessage,
  AiChatResult,
  AiChatUsage,
  AiToolDefinition,
} from './ai-provider.interface';

interface AnthropicContentBlock {
  type: 'text' | 'tool_use';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}
/** `usage` is always present on a real Messages API response — see
 *  platform.claude.com/docs/en/about-claude/pricing for the documented shape (this codebase
 *  doesn't use prompt caching or server-side tools, so only input_tokens/output_tokens are read;
 *  cache_read_input_tokens/cache_creation_input_tokens/server_tool_use are real fields on the
 *  response too but would only matter if those features were ever adopted here). */
interface AnthropicResponse {
  content: AnthropicContentBlock[];
  stop_reason: string;
  usage?: { input_tokens: number; output_tokens: number };
}

function toAnthropicMessages(messages: AiChatMessage[]): unknown[] {
  return messages.map((message) => {
    if (message.role === 'user') {
      return { role: 'user', content: message.content };
    }
    if (message.role === 'assistant' && 'toolCalls' in message) {
      return {
        role: 'assistant',
        content: message.toolCalls.map((call) => ({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: call.input,
        })),
      };
    }
    if (message.role === 'assistant') {
      return { role: 'assistant', content: message.content };
    }
    return {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: message.toolCallId,
          content: message.content,
        },
      ],
    };
  });
}

/** Real provider, bound only when AI_API_KEY is configured (see AiModule). */
export class AnthropicAIProvider implements AIProvider {
  readonly name = 'anthropic';
  private readonly logger = new Logger(AnthropicAIProvider.name);

  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async chat(input: {
    systemPrompt: string;
    messages: AiChatMessage[];
    tools: AiToolDefinition[];
  }): Promise<AiChatResult> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        system: input.systemPrompt,
        messages: toAnthropicMessages(input.messages),
        tools:
          input.tools.length > 0
            ? input.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.inputSchema,
              }))
            : undefined,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(
        `Anthropic API responded with ${response.status}: ${body}`,
      );
      throw new Error(`Anthropic API responded with status ${response.status}`);
    }

    const data = (await response.json()) as AnthropicResponse;
    const usage: AiChatUsage | undefined = data.usage
      ? {
          inputTokens: data.usage.input_tokens,
          outputTokens: data.usage.output_tokens,
        }
      : undefined;

    if (data.stop_reason === 'tool_use') {
      const toolCalls = data.content
        .filter((block) => block.type === 'tool_use')
        .map((block) => ({
          id: block.id!,
          name: block.name!,
          input: block.input ?? {},
        }));
      return { type: 'tool_calls', toolCalls, usage };
    }

    const text = data.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    return { type: 'text', text, usage };
  }
}
