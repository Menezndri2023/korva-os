import { Logger } from '@nestjs/common';
import type {
  EmailProvider,
  EmailSendResult,
} from './email-provider.interface';

/** Real provider, bound only when RESEND_API_KEY is configured (see CommunicationModule). */
export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';
  private readonly logger = new Logger(ResendEmailProvider.name);

  constructor(
    private readonly apiKey: string,
    private readonly fromAddress: string,
  ) {}

  async send(input: {
    to: string;
    subject: string;
    body: string;
  }): Promise<EmailSendResult> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.fromAddress,
        to: input.to,
        subject: input.subject,
        html: input.body,
      }),
    });

    if (!response.ok) {
      this.logger.error(
        `Resend responded with status ${response.status} for an email to ${input.to}`,
      );
      return { providerReference: '', status: 'failed' };
    }

    const data = (await response.json()) as { id: string };
    return { providerReference: data.id, status: 'sent' };
  }
}
