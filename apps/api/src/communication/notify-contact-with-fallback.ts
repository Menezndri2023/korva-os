import { Logger } from '@nestjs/common';
import { ConversationsService } from './conversations/conversations.service';

/** Extracts the `code` from a NestJS HttpException thrown as `new XException({ code, message })`
 *  — the shape every business error in this codebase uses. Nest stores the constructor's body as
 *  `.response` on the thrown instance. */
function errorCode(error: unknown): string | undefined {
  const response = (error as { response?: unknown } | undefined)?.response;
  return response && typeof response === 'object' && 'code' in response
    ? String(response.code)
    : undefined;
}

/**
 * Tries WhatsApp first, falls back to email on any failure (missing consent, no phone/email on
 * file, provider outage), and gives up (returning undefined) if neither channel can reach this
 * contact — never throws, so a caller's own best-effort semantics (a scheduler sweep, a
 * best-effort notification fired after a state change) are never broken by one contact's channel
 * gap. Returns the channel actually used. Shared by BookingReminderSchedulerService and
 * BookingsService.complete() — both need the identical "system-initiated, no real acting user,
 * best-effort" send.
 */
export async function sendWithChannelFallback(
  conversationsService: ConversationsService,
  logger: Logger,
  organizationId: string,
  contactId: string,
  body: string,
  context: string,
): Promise<'whatsapp' | 'email' | undefined> {
  for (const channel of ['whatsapp', 'email'] as const) {
    try {
      const conversation =
        await conversationsService.findOrCreateForContactAndChannel(
          organizationId,
          contactId,
          channel,
        );
      await conversationsService.sendMessage(
        organizationId,
        undefined,
        conversation.id as string,
        { body },
      );
      return channel;
    } catch (error) {
      logger.warn(
        `${context}: ${channel} send failed for contact ${contactId} (${errorCode(error) ?? 'unknown error'}), trying next channel`,
      );
    }
  }
  return undefined;
}
