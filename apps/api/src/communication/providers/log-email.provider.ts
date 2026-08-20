import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type {
  EmailProvider,
  EmailSendResult,
} from './email-provider.interface';

/**
 * Default provider for MVP/dev/test: represents an email "sent" by logging it, no
 * external gateway call. Used whenever RESEND_API_KEY is not configured — mirrors
 * ManualPaymentProvider's role in Finance (works out of the box, no live credentials
 * required).
 */
@Injectable()
export class LogEmailProvider implements EmailProvider {
  readonly name = 'log';
  private readonly logger = new Logger(LogEmailProvider.name);

  send(input: {
    to: string;
    subject: string;
    body: string;
  }): Promise<EmailSendResult> {
    this.logger.log(`[email] to=${input.to} subject="${input.subject}"`);
    return Promise.resolve({
      providerReference: `log_${randomBytes(12).toString('hex')}`,
      status: 'sent',
    });
  }
}
