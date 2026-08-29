import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { validateEnv } from './core/config/env.validation';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { JwtAuthGuard } from './core/guards/jwt-auth.guard';
import { TenantGuard } from './core/guards/tenant.guard';
import { ModuleGuard } from './core/guards/module.guard';
import { PermissionsGuard } from './core/guards/permissions.guard';

import { IdentityModule } from './identity/identity.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { AuditModule } from './audit/audit.module';
import { HealthModule } from './health/health.module';
import { CustomFieldsModule } from './custom-fields/custom-fields.module';
import { CrmModule } from './crm/crm.module';
import { CatalogModule } from './catalog/catalog.module';
import { FinanceModule } from './finance/finance.module';
import { BookingModule } from './booking/booking.module';
import { CommerceModule } from './commerce/commerce.module';
import { EventsModule } from './core/events/events.module';
import { WorkflowModule } from './workflow/workflow.module';
import { CommunicationModule } from './communication/communication.module';
import { AiModule } from './ai/ai.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { PublicModule } from './public/public.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { BusinessGraphModule } from './business-graph/business-graph.module';
import { DecisionEngineModule } from './decision-engine/decision-engine.module';
import { ActionCenterModule } from './action-center/action-center.module';
import { WebhookSubscriptionsModule } from './webhook-subscriptions/webhook-subscriptions.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.getOrThrow<string>('MONGODB_URI'),
      }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    EventsModule,
    HealthModule,
    AuditModule,
    IdentityModule,
    SubscriptionsModule,
    OrganizationsModule,
    CustomFieldsModule,
    CrmModule,
    CatalogModule,
    FinanceModule,
    BookingModule,
    CommerceModule,
    CommunicationModule,
    WorkflowModule,
    AiModule,
    AnalyticsModule,
    PublicModule,
    IntegrationsModule,
    BusinessGraphModule,
    DecisionEngineModule,
    ActionCenterModule,
    WebhookSubscriptionsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: ModuleGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
