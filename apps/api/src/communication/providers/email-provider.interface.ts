export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

export interface EmailSendResult {
  providerReference: string;
  status: 'sent' | 'failed';
}

/**
 * Business logic must never talk to an email gateway (Resend, SMTP, ...) directly —
 * only through this interface, injected via the EMAIL_PROVIDER token. Swapping
 * providers means adding a new implementation and rebinding the token, never
 * touching ConversationsService/WorkflowActionsService.
 */
export interface EmailProvider {
  readonly name: string;
  send(input: {
    to: string;
    subject: string;
    body: string;
  }): Promise<EmailSendResult>;
}
