import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import type { AiTool } from './tool.interface';
import { ConversationsService } from '../../communication/conversations/conversations.service';

const inputSchema = z.object({
  contactId: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
});

/** Reuses (or opens) an email Conversation with the contact — a single AI-sent email is not the "send_mass_campaign" sensitive action from docs/ai.md, which isn't a tool in this MVP set. */
@Injectable()
export class SendEmailTool implements AiTool<z.infer<typeof inputSchema>> {
  readonly definition = {
    name: 'send_email',
    description:
      'Envoie un e-mail à un contact (ouvre une conversation email si nécessaire).',
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['contactId', 'subject', 'body'],
    },
  };
  readonly requiredPermission = 'conversations.create' as const;
  readonly auditEntity = 'message';

  constructor(private readonly conversationsService: ConversationsService) {}

  parseInput(raw: unknown) {
    return inputSchema.parse(raw);
  }

  async execute(
    organizationId: string,
    userId: string,
    input: z.infer<typeof inputSchema>,
  ) {
    const { data } = await this.conversationsService.list(organizationId, {
      page: 1,
      limit: 1,
      contactId: input.contactId,
      status: 'open',
      channel: 'email',
    });
    const conversation =
      data[0] ??
      (await this.conversationsService.create(organizationId, userId, {
        contactId: input.contactId,
        channel: 'email',
        subject: input.subject,
      }));

    const message = await this.conversationsService.sendMessage(
      organizationId,
      userId,
      conversation.id as string,
      { subject: input.subject, body: input.body },
    );
    return {
      conversationId: conversation.id as string,
      messageId: message.id as string,
      status: message.status,
    };
  }
}
