import { Injectable } from '@nestjs/common';
import type { AIProvider, AiChatResult } from './ai-provider.interface';

/** Shown to a business when KORVA IA has no brain configured on this platform. Written for the
 *  business, not for a developer: it is the platform's state, not something they can fix. */
export const KORVA_AI_UNAVAILABLE_MESSAGE =
  "KORVA IA n'est pas encore activée sur la plateforme. Elle arrive très bientôt : ce message ne compte pas dans votre quota.";

/**
 * Bound when no AI provider is configured (see korva-ai.config.ts): never calls tools, always
 * returns the message above. Keeps the rest of the pipeline (conversations, permissions, audit)
 * usable and testable without a live model — mirrors LogEmailProvider's role.
 */
@Injectable()
export class NullAIProvider implements AIProvider {
  readonly name = 'null';

  chat(): Promise<AiChatResult> {
    return Promise.resolve({
      type: 'text',
      text: KORVA_AI_UNAVAILABLE_MESSAGE,
    });
  }
}
