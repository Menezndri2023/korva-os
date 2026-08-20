export const MESSAGING_PROVIDER = Symbol('MESSAGING_PROVIDER');

export interface MessagingSendResult {
  providerReference: string;
  status: 'sent' | 'failed';
}

/**
 * Abstraction for chat-style channels (WhatsApp Business API, SMS, ...). Only a
 * log-only default implementation exists for the MVP — real WhatsApp/SMS delivery
 * is architecture-ready but out of scope until a real provider is needed (see
 * docs/IMPLEMENTATION_PLAN.md, Phase 8).
 */
export interface MessagingProvider {
  readonly name: string;
  send(input: { to: string; body: string }): Promise<MessagingSendResult>;
}
