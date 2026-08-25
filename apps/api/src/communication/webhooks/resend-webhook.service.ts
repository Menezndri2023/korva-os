import { Injectable, Logger } from '@nestjs/common';
import type { MessageStatus } from '@korva/types';
import { resendWebhookEventSchema } from '@korva/validation';
import { MessagesRepository } from '../conversations/messages.repository';

/**
 * Resend event types (https://resend.com/docs/dashboard/webhooks/event-types) that map onto a
 * MessageStatus this app actually tracks. Anything else — email.sent (redundant with the
 * synchronous send result we already recorded), email.delivery_delayed, email.opened,
 * email.clicked — is acknowledged (200) but doesn't change the Message record: MessageStatus has
 * no "opened"/"delayed" state, and adding one for events nothing in this codebase reads yet would
 * be speculative scope creep.
 */
const EVENT_TO_STATUS: Partial<Record<string, MessageStatus>> = {
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
};

@Injectable()
export class ResendWebhookService {
  private readonly logger = new Logger(ResendWebhookService.name);

  constructor(private readonly messagesRepository: MessagesRepository) {}

  /**
   * `rawPayload` must already be signature-verified by the caller (ResendWebhookController) —
   * this method does no auth of its own, it only interprets an already-trusted event.
   */
  async handleEvent(rawPayload: unknown): Promise<{ handled: boolean }> {
    const parsed = resendWebhookEventSchema.safeParse(rawPayload);
    if (!parsed.success) {
      this.logger.warn(
        `Ignoring a Resend webhook event with an unexpected shape: ${parsed.error.message}`,
      );
      return { handled: false };
    }

    const { type, data } = parsed.data;
    const status = EVENT_TO_STATUS[type];
    if (!status) {
      this.logger.debug(`Ignoring unhandled Resend event type "${type}"`);
      return { handled: false };
    }

    const updated =
      await this.messagesRepository.updateStatusByProviderReference(
        data.email_id,
        status,
      );
    if (!updated) {
      this.logger.warn(
        `Resend "${type}" event for email_id=${data.email_id} matched no known message`,
      );
      return { handled: false };
    }

    this.logger.log(
      `Applied Resend "${type}" event to message ${String(updated._id)} (status=${status})`,
    );
    return { handled: true };
  }
}
