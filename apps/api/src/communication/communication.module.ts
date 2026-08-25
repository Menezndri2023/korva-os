import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import {
  MessageTemplate,
  MessageTemplateSchema,
} from './message-templates/schemas/message-template.schema';
import {
  Conversation,
  ConversationSchema,
} from './conversations/schemas/conversation.schema';
import { Message, MessageSchema } from './conversations/schemas/message.schema';
import {
  Notification,
  NotificationSchema,
} from './notifications/schemas/notification.schema';

import { MessageTemplatesRepository } from './message-templates/message-templates.repository';
import { MessageTemplatesService } from './message-templates/message-templates.service';
import { MessageTemplatesController } from './message-templates/message-templates.controller';

import { ConversationsRepository } from './conversations/conversations.repository';
import { MessagesRepository } from './conversations/messages.repository';
import { ConversationsService } from './conversations/conversations.service';
import { ConversationsController } from './conversations/conversations.controller';

import { NotificationsRepository } from './notifications/notifications.repository';
import { NotificationsService } from './notifications/notifications.service';
import { NotificationsController } from './notifications/notifications.controller';

import { MESSAGING_PROVIDER } from './providers/messaging-provider.interface';
import { LogMessagingProvider } from './providers/log-messaging.provider';

import { ResendWebhookController } from './webhooks/resend-webhook.controller';
import { ResendWebhookService } from './webhooks/resend-webhook.service';

import { CrmModule } from '../crm/crm.module';
import { IdentityModule } from '../identity/identity.module';
import { AuditModule } from '../audit/audit.module';
import { EmailModule } from '../shared/email/email.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MessageTemplate.name, schema: MessageTemplateSchema },
      { name: Conversation.name, schema: ConversationSchema },
      { name: Message.name, schema: MessageSchema },
      { name: Notification.name, schema: NotificationSchema },
    ]),
    CrmModule,
    IdentityModule,
    AuditModule,
    EmailModule,
  ],
  controllers: [
    MessageTemplatesController,
    ConversationsController,
    NotificationsController,
    ResendWebhookController,
  ],
  providers: [
    MessageTemplatesRepository,
    MessageTemplatesService,
    ConversationsRepository,
    MessagesRepository,
    ConversationsService,
    NotificationsRepository,
    NotificationsService,
    ResendWebhookService,
    { provide: MESSAGING_PROVIDER, useClass: LogMessagingProvider },
  ],
  exports: [EmailModule, NotificationsService, ConversationsService],
})
export class CommunicationModule {}
