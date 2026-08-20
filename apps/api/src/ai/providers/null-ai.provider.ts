import { Injectable } from '@nestjs/common';
import type { AIProvider, AiChatResult } from './ai-provider.interface';

/**
 * Default provider when no AI_API_KEY is configured: never calls tools, always returns a
 * fixed message. Keeps the rest of the pipeline (conversations, memory, permission checks,
 * audit) fully usable and testable without a live LLM — mirrors LogEmailProvider's role.
 */
@Injectable()
export class NullAIProvider implements AIProvider {
  readonly name = 'null';

  chat(): Promise<AiChatResult> {
    return Promise.resolve({
      type: 'text',
      text: "L'assistant IA n'est pas configuré pour cette organisation. Contactez votre administrateur pour activer l'intégration IA (AI_API_KEY).",
    });
  }
}
