import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';

import {
  AiConversation,
  AiConversationSchema,
} from './schemas/ai-conversation.schema';
import { AiMessage, AiMessageSchema } from './schemas/ai-message.schema';
import {
  AiPendingAction,
  AiPendingActionSchema,
} from './schemas/ai-pending-action.schema';
import { Order, OrderSchema } from '../commerce/orders/schemas/order.schema';

import { AiConversationsRepository } from './ai-conversations.repository';
import { AiMessagesRepository } from './ai-messages.repository';
import { AiPendingActionsRepository } from './ai-pending-actions.repository';
import { AiContextBuilderService } from './ai-context-builder.service';
import { AiToolsRegistryService } from './ai-tools-registry.service';
import { AiOrchestratorService } from './ai-orchestrator.service';
import { AiController } from './ai.controller';

import {
  AI_PROVIDER,
  type AIProvider,
} from './providers/ai-provider.interface';
import { NullAIProvider } from './providers/null-ai.provider';
import { AnthropicAIProvider } from './providers/anthropic-ai.provider';

import { SearchContactsTool } from './tools/search-contacts.tool';
import { GetCustomerTool } from './tools/get-customer.tool';
import { CreateCustomerTool } from './tools/create-customer.tool';
import { SearchLeadsTool } from './tools/search-leads.tool';
import { UpdateLeadTool } from './tools/update-lead.tool';
import { CreateTaskTool } from './tools/create-task.tool';
import { SearchOffersTool } from './tools/search-offers.tool';
import { GetOfferTool } from './tools/get-offer.tool';
import { GetAvailabilityTool } from './tools/get-availability.tool';
import { CreateQuoteTool } from './tools/create-quote.tool';
import { GetQuoteTool } from './tools/get-quote.tool';
import { CreateBookingTool } from './tools/create-booking.tool';
import { CancelBookingTool } from './tools/cancel-booking.tool';
import { GetOrderTool } from './tools/get-order.tool';
import { CreateOrderTool } from './tools/create-order.tool';
import { GetInvoiceTool } from './tools/get-invoice.tool';
import { GetSalesReportTool } from './tools/get-sales-report.tool';
import { SendEmailTool } from './tools/send-email.tool';
import { SendWhatsappTool } from './tools/send-whatsapp.tool';

import { CrmModule } from '../crm/crm.module';
import { CatalogModule } from '../catalog/catalog.module';
import { BookingModule } from '../booking/booking.module';
import { FinanceModule } from '../finance/finance.module';
import { CommerceModule } from '../commerce/commerce.module';
import { CommunicationModule } from '../communication/communication.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AiConversation.name, schema: AiConversationSchema },
      { name: AiMessage.name, schema: AiMessageSchema },
      { name: AiPendingAction.name, schema: AiPendingActionSchema },
      { name: Order.name, schema: OrderSchema },
    ]),
    ConfigModule,
    CrmModule,
    CatalogModule,
    BookingModule,
    FinanceModule,
    CommerceModule,
    CommunicationModule,
    OrganizationsModule,
    AuditModule,
  ],
  controllers: [AiController],
  providers: [
    AiConversationsRepository,
    AiMessagesRepository,
    AiPendingActionsRepository,
    AiContextBuilderService,
    AiToolsRegistryService,
    AiOrchestratorService,

    SearchContactsTool,
    GetCustomerTool,
    CreateCustomerTool,
    SearchLeadsTool,
    UpdateLeadTool,
    CreateTaskTool,
    SearchOffersTool,
    GetOfferTool,
    GetAvailabilityTool,
    CreateQuoteTool,
    GetQuoteTool,
    CreateBookingTool,
    CancelBookingTool,
    GetOrderTool,
    CreateOrderTool,
    GetInvoiceTool,
    GetSalesReportTool,
    SendEmailTool,
    SendWhatsappTool,

    {
      provide: AI_PROVIDER,
      useFactory: (configService: ConfigService): AIProvider => {
        const apiKey = configService.get<string>('AI_API_KEY');
        if (
          configService.get<string>('AI_PROVIDER') === 'anthropic' &&
          apiKey
        ) {
          return new AnthropicAIProvider(
            apiKey,
            configService.get<string>('AI_MODEL') ?? 'claude-sonnet-5',
          );
        }
        return new NullAIProvider();
      },
      inject: [ConfigService],
    },
  ],
})
export class AiModule {}
