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
import { PlanFeatureGuard } from './core/guards/plan-feature.guard';
import { PermissionsGuard } from './core/guards/permissions.guard';

import { IdentityModule } from './identity/identity.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { AuditModule } from './audit/audit.module';
import { HealthModule } from './health/health.module';
import { MigrationsModule } from './core/migrations/migrations.module';
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
import { ActivationModule } from './activation/activation.module';
import { PlatformAdminModule } from './platform-admin/platform-admin.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { SubscriptionBillingModule } from './subscription-billing/subscription-billing.module';
import { PublicModule } from './public/public.module';
import { CustomerAuthModule } from './customer-auth/customer-auth.module';
import { ReviewsModule } from './reviews/reviews.module';
import { PlatformReviewsModule } from './platform-reviews/platform-reviews.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { BusinessGraphModule } from './business-graph/business-graph.module';
import { DecisionEngineModule } from './decision-engine/decision-engine.module';
import { ActionCenterModule } from './action-center/action-center.module';
import { WebhookSubscriptionsModule } from './webhook-subscriptions/webhook-subscriptions.module';
import { MarketingModule } from './marketing/marketing.module';
import { CustomerServiceModule } from './customer-service/customer-service.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.getOrThrow<string>('MONGODB_URI'),
        /**
         * Mongoose defaults this to true, which means every API instance starts an index build
         * for every model on every boot — harmless on a laptop, a real hazard against a cluster
         * with several instances rolling at once and collections large enough for a build to
         * matter.
         *
         * In production, indexes are built by migrations/0001-sync-indexes.ts instead, run from
         * the deploy pipeline BEFORE the new instances start (see docs/deployment.md's runbook
         * and scripts/migrate.ts). Left on everywhere else so local development and the e2e
         * suite keep working with no extra step — the suite also calls syncIndexes() itself in
         * its own bootstrap, so it never depended on this.
         */
        autoIndex: configService.get<string>('NODE_ENV') !== 'production',
      }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    EventsModule,
    HealthModule,
    MigrationsModule,
    AuditModule,
    IdentityModule,
    SubscriptionsModule,
    ActivationModule,
    PlatformAdminModule,
    SubscriptionBillingModule,
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
    CustomerAuthModule,
    ReviewsModule,
    PlatformReviewsModule,
    IntegrationsModule,
    BusinessGraphModule,
    DecisionEngineModule,
    ActionCenterModule,
    WebhookSubscriptionsModule,
    MarketingModule,
    CustomerServiceModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: ModuleGuard },
    { provide: APP_GUARD, useClass: PlanFeatureGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
