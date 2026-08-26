export const MESSAGING_PROVIDER = Symbol('MESSAGING_PROVIDER');

export interface MessagingSendResult {
  providerReference: string;
  /**
   * Extended from the original 'sent' | 'failed' (additive superset — see
   * docs/architecture/integrations-platform.md §5) to carry real WhatsApp delivery-status
   * semantics: 'delivered'/'read' are reached only via an async status webhook, exactly like
   * MessageStatus's own 'delivered'/'bounced'/'complained' pattern for email (see
   * packages/types/src/communication.ts and apps/api/src/communication/webhooks/).
   */
  status: 'sent' | 'delivered' | 'read' | 'failed';
}

export interface SendTemplateInput {
  to: string;
  templateName: string;
  params: Record<string, string>;
  /** WhatsApp Business template category — determines Meta's approval/pricing rules. */
  category: 'marketing' | 'utility' | 'authentication';
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
  /**
   * Business-initiated send outside a customer-initiated 24h session window — WhatsApp requires
   * a pre-approved template for this. Optional so existing implementers of `MessagingProvider`
   * keep compiling unchanged; `MessagingProviderResolverService` and any Stage 2 WhatsApp adapter
   * are expected to implement it. See docs/architecture/integrations-platform.md §5.
   */
  sendTemplate?(input: SendTemplateInput): Promise<MessagingSendResult>;
}
