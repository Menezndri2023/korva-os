import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';

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

import {
  EMAIL_PROVIDER,
  type EmailProvider,
} from './providers/email-provider.interface';
import { LogEmailProvider } from './providers/log-email.provider';
import { ResendEmailProvider } from './providers/resend-email.provider';
import { MESSAGING_PROVIDER } from './providers/messaging-provider.interface';
import { LogMessagingProvider } from './providers/log-messaging.provider';

import { CrmModule } from '../crm/crm.module';
import { IdentityModule } from '../identity/identity.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MessageTemplate.name, schema: MessageTemplateSchema },
      { name: Conversation.name, schema: ConversationSchema },
      { name: Message.name, schema: MessageSchema },
      { name: Notification.name, schema: NotificationSchema },
    ]),
    ConfigModule,
    CrmModule,
    IdentityModule,
    AuditModule,
  ],
  controllers: [
    MessageTemplatesController,
    ConversationsController,
    NotificationsController,
  ],
  providers: [
    MessageTemplatesRepository,
    MessageTemplatesService,
    ConversationsRepository,
    MessagesRepository,
    ConversationsService,
    NotificationsRepository,
    NotificationsService,
    {
      provide: EMAIL_PROVIDER,
      useFactory: (configService: ConfigService): EmailProvider => {
        const apiKey = configService.get<string>('RESEND_API_KEY');
        if (
          configService.get<string>('EMAIL_PROVIDER') === 'resend' &&
          apiKey
        ) {
          return new ResendEmailProvider(
            apiKey,
            configService.get<string>('EMAIL_FROM') ?? 'no-reply@korva.app',
          );
        }
        return new LogEmailProvider();
      },
      inject: [ConfigService],
    },
    { provide: MESSAGING_PROVIDER, useClass: LogMessagingProvider },
  ],
  exports: [EMAIL_PROVIDER, NotificationsService],
})
export class CommunicationModule {}
