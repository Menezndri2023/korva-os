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
import type { ConsentChannel, MessageStatus, Pagination } from '@korva/types';
import { ConversationsRepository } from './conversations.repository';
import { MessagesRepository } from './messages.repository';
import { ConversationDocument } from './schemas/conversation.schema';
import { MessageDocument } from './schemas/message.schema';
import { ContactDocument } from '../../crm/contacts/schemas/contact.schema';
import { ContactsService } from '../../crm/contacts/contacts.service';
import { MessageTemplatesService } from '../message-templates/message-templates.service';
import { AuditService } from '../../audit/audit.service';
import { interpolate } from '../../shared/template';
import {
  EMAIL_PROVIDER,
  type EmailProvider,
} from '../providers/email-provider.interface';
import { MessagingProviderResolverService } from '../providers/messaging-provider-resolver.service';
import { EventBusService } from '../../core/events/event-bus.service';

/** e.g. '360dialog' — the only WhatsApp/SMS BSP provider key registered today (see
 *  MessagingProviderRegistry). Every tenant-scoped whatsapp/sms send resolves through this exact
 *  provider key; adding a second messaging provider later is a MessagingProviderRegistry change,
 *  not a change here. */
const MESSAGING_TENANT_PROVIDER = '360dialog';

@Injectable()
export class ConversationsService {
  constructor(
    private readonly conversationsRepository: ConversationsRepository,
    private readonly messagesRepository: MessagesRepository,
    private readonly contactsService: ContactsService,
    private readonly messageTemplatesService: MessageTemplatesService,
    private readonly auditService: AuditService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
    private readonly messagingProviderResolver: MessagingProviderResolverService,
    private readonly eventBus: EventBusService,
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

    // Opening a NEW whatsapp conversation is, by definition, business-initiated (nobody has
    // messaged first yet — if they had, an existing conversation would already exist and this
    // path wouldn't run) — exactly the case Meta's opt-in policy targets, per
    // docs/architecture/integrations-platform.md §5. Replying inside an already-open conversation
    // (ConversationsService.sendMessage, elsewhere) stays permissive on purpose — Meta does not
    // require opt-in for that. This check does not apply to email/sms/internal conversations.
    if (
      input.channel === 'whatsapp' &&
      !hasActiveConsent(contact, 'whatsapp')
    ) {
      throw new BadRequestException({
        code: 'WHATSAPP_CONSENT_MISSING',
        message:
          'This contact has no active WhatsApp consent on file — a business-initiated WhatsApp conversation cannot be opened without it',
      });
    }

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
      const escapeHtml = conversation.channel === 'email';
      body = interpolate(template.body, payload, { escapeHtml }) || body;
      subject =
        subject ??
        (template.subject
          ? interpolate(template.subject, payload, { escapeHtml })
          : undefined);
    }

    let status: MessageStatus = 'sent';
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
      // Stage 2.4: resolves the REAL tenant-scoped provider for this organization — never the
      // old global process-wide messaging binding. Fails closed (WHATSAPP_NOT_CONNECTED) if this
      // tenant has no active messaging IntegrationAccount; never silently falls back to another
      // tenant's credential or a process-wide one.
      const messagingProvider =
        await this.messagingProviderResolver.resolveTenantProvider({
          organizationId,
          provider: MESSAGING_TENANT_PROVIDER,
        });
      const result = await messagingProvider.send({ to, body });
      // Message doesn't model a 'read' receipt yet (that's a Stage 2 concern once a real
      // delivery-status webhook exists) — degrade to 'delivered', the closest state it does
      // model, rather than widening MessageStatus for a value no provider produces today.
      status = result.status === 'read' ? 'delivered' : result.status;
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

    await this.eventBus.publish(organizationId, 'message.sent', {
      messageId: message.id as string,
      conversationId,
      contactId: conversation.contactId.toString(),
      channel: conversation.channel,
      status,
    });

    return message;
  }
}

/** True iff `contact` has a consent entry for `channel` that was granted and never revoked — the
 *  minimal check docs/architecture/integrations-platform.md §5 calls for, deliberately not more
 *  (no expiry, no scope beyond channel): the goal is auditable and safe, not a full consent
 *  management system nobody asked for. */
function hasActiveConsent(
  contact: ContactDocument,
  channel: ConsentChannel,
): boolean {
  return contact.consents.some(
    (consent) => consent.channel === channel && !consent.revokedAt,
  );
}
