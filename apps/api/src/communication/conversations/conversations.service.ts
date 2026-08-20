import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type {
  CreateConversationInput,
  CreateMessageInput,
  ListConversationsQuery,
  UpdateConversationInput,
} from '@korva/validation';
import type { Pagination } from '@korva/types';
import { ConversationsRepository } from './conversations.repository';
import { MessagesRepository } from './messages.repository';
import { ConversationDocument } from './schemas/conversation.schema';
import { MessageDocument } from './schemas/message.schema';
import { ContactsService } from '../../crm/contacts/contacts.service';
import { MessageTemplatesService } from '../message-templates/message-templates.service';
import { AuditService } from '../../audit/audit.service';
import { interpolate } from '../../shared/template';
import {
  EMAIL_PROVIDER,
  type EmailProvider,
} from '../providers/email-provider.interface';
import {
  MESSAGING_PROVIDER,
  type MessagingProvider,
} from '../providers/messaging-provider.interface';

@Injectable()
export class ConversationsService {
  constructor(
    private readonly conversationsRepository: ConversationsRepository,
    private readonly messagesRepository: MessagesRepository,
    private readonly contactsService: ContactsService,
    private readonly messageTemplatesService: MessageTemplatesService,
    private readonly auditService: AuditService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
    @Inject(MESSAGING_PROVIDER)
    private readonly messagingProvider: MessagingProvider,
  ) {}

  async create(
    organizationId: string,
    userId: string,
    input: CreateConversationInput,
  ): Promise<ConversationDocument> {
    const contact = await this.contactsService.getById(
      organizationId,
      input.contactId,
    );

    const conversation = await this.conversationsRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      contactId: new Types.ObjectId(contact.id as string),
      channel: input.channel,
      subject: input.subject,
      status: 'open',
    });

    await this.auditService.record({
      organizationId,
      userId,
      action: 'CREATE',
      entity: 'conversation',
      entityId: conversation.id as string,
    });

    return conversation;
  }

  async getById(
    organizationId: string,
    id: string,
  ): Promise<ConversationDocument> {
    const conversation = await this.conversationsRepository.findById(
      organizationId,
      id,
    );
    if (!conversation) {
      throw new NotFoundException({
        code: 'CONVERSATION_NOT_FOUND',
        message: 'Conversation not found',
      });
    }
    return conversation;
  }

  async list(
    organizationId: string,
    query: ListConversationsQuery,
  ): Promise<{ data: ConversationDocument[]; pagination: Pagination }> {
    const { data, total } = await this.conversationsRepository.findAll(
      organizationId,
      query,
    );
    return {
      data,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  async update(
    organizationId: string,
    userId: string,
    id: string,
    input: UpdateConversationInput,
  ): Promise<ConversationDocument> {
    const updated = await this.conversationsRepository.update(
      organizationId,
      id,
      { status: input.status },
    );
    if (!updated) {
      throw new NotFoundException({
        code: 'CONVERSATION_NOT_FOUND',
        message: 'Conversation not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'conversation',
      entityId: id,
      metadata: { status: input.status },
    });

    return updated;
  }

  listMessages(
    organizationId: string,
    conversationId: string,
  ): Promise<MessageDocument[]> {
    return this.messagesRepository.findAllForConversation(
      organizationId,
      conversationId,
    );
  }

  async sendMessage(
    organizationId: string,
    userId: string,
    conversationId: string,
    input: CreateMessageInput,
  ): Promise<MessageDocument> {
    const conversation = await this.getById(organizationId, conversationId);
    if (conversation.status === 'closed') {
      throw new BadRequestException({
        code: 'CONVERSATION_CLOSED',
        message: 'Cannot send a message on a closed conversation',
      });
    }
    const contact = await this.contactsService.getById(
      organizationId,
      conversation.contactId.toString(),
    );

    let body = input.body;
    let subject = input.subject;
    if (input.templateId) {
      const template = await this.messageTemplatesService.getById(
        organizationId,
        input.templateId,
      );
      const payload = {
        contact: {
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email,
          phone: contact.phone,
        },
      };
      body = interpolate(template.body, payload) || body;
      subject =
        subject ??
        (template.subject ? interpolate(template.subject, payload) : undefined);
    }

    let status: 'sent' | 'failed' = 'sent';
    let providerReference: string | undefined;
    let to: string | undefined;

    if (conversation.channel === 'email') {
      to = contact.email;
      if (!to) {
        throw new BadRequestException({
          code: 'CONTACT_HAS_NO_EMAIL',
          message: 'This contact has no email address on file',
        });
      }
      const result = await this.emailProvider.send({
        to,
        subject: subject ?? conversation.subject ?? '(sans objet)',
        body,
      });
      status = result.status;
      providerReference = result.providerReference;
    } else if (
      conversation.channel === 'whatsapp' ||
      conversation.channel === 'sms'
    ) {
      to = contact.phone;
      if (!to) {
        throw new BadRequestException({
          code: 'CONTACT_HAS_NO_PHONE',
          message: 'This contact has no phone number on file',
        });
      }
      const result = await this.messagingProvider.send({ to, body });
      status = result.status;
      providerReference = result.providerReference;
    }

    const message = await this.messagesRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      conversationId: new Types.ObjectId(conversationId),
      direction: 'outbound',
      to,
      subject,
      body,
      status,
      providerReference,
    });

    await this.conversationsRepository.update(organizationId, conversationId, {
      lastMessageAt: new Date(),
    });

    await this.auditService.record({
      organizationId,
      userId,
      action: 'CREATE',
      entity: 'message',
      entityId: message.id as string,
      metadata: { conversationId, channel: conversation.channel, status },
    });

    return message;
  }
}
