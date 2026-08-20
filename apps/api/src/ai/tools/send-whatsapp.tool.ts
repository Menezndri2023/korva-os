import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import type { AiTool } from './tool.interface';
import { ConversationsService } from '../../communication/conversations/conversations.service';

const inputSchema = z.object({
  contactId: z.string().min(1),
  body: z.string().min(1),
});

@Injectable()
export class SendWhatsappTool implements AiTool<z.infer<typeof inputSchema>> {
  readonly definition = {
    name: 'send_whatsapp',
    description:
      'Envoie un message WhatsApp à un contact (ouvre une conversation WhatsApp si nécessaire).',
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['contactId', 'body'],
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
      channel: 'whatsapp',
    });
    const conversation =
      data[0] ??
      (await this.conversationsService.create(organizationId, userId, {
        contactId: input.contactId,
        channel: 'whatsapp',
      }));

    const message = await this.conversationsService.sendMessage(
      organizationId,
      userId,
      conversation.id as string,
      { body: input.body },
    );
    return {
      conversationId: conversation.id as string,
      messageId: message.id as string,
      status: message.status,
    };
  }
}
