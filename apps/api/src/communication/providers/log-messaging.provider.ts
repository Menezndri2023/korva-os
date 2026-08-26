import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type {
  MessagingProvider,
  MessagingSendResult,
  SendTemplateInput,
} from './messaging-provider.interface';

/** Only implementation for the MVP — logs the message instead of calling a real WhatsApp/SMS API. */
@Injectable()
export class LogMessagingProvider implements MessagingProvider {
  readonly name = 'log';
  private readonly logger = new Logger(LogMessagingProvider.name);

  send(input: { to: string; body: string }): Promise<MessagingSendResult> {
    this.logger.log(`[messaging] to=${input.to} body="${input.body}"`);
    return Promise.resolve({
      providerReference: `log_${randomBytes(12).toString('hex')}`,
      status: 'sent',
    });
  }

  sendTemplate(input: SendTemplateInput): Promise<MessagingSendResult> {
    this.logger.log(
      `[messaging] template to=${input.to} template=${input.templateName} category=${input.category} params=${JSON.stringify(input.params)}`,
    );
    return Promise.resolve({
      providerReference: `log_${randomBytes(12).toString('hex')}`,
      status: 'sent',
    });
  }
}
