import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Organization,
  OrganizationSchema,
} from '../organizations/schemas/organization.schema';
import { JwtModule } from '@nestjs/jwt';
import {
  PlatformAdmin,
  PlatformAdminSchema,
} from './schemas/platform-admin.schema';
import { PlatformAdminAuthService } from './platform-admin-auth.service';
import { PlatformAdminAuthController } from './platform-admin-auth.controller';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { SubscriptionBillingModule } from '../subscription-billing/subscription-billing.module';
import { AuditModule } from '../audit/audit.module';
import { ActivationModule } from '../activation/activation.module';
import { IdentityModule } from '../identity/identity.module';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformReviewsModule } from '../platform-reviews/platform-reviews.module';
import { PlatformReviewsAdminController } from './platform-reviews-admin.controller';
import { PlatformPayoutsAdminController } from './platform-payouts-admin.controller';
import { FinanceModule } from '../finance/finance.module';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformInsightsService } from './platform-insights.service';
import { PlatformInsightsController } from './platform-insights.controller';
import {
  PlatformNote,
  PlatformNoteSchema,
} from './schemas/platform-note.schema';
import { IntegrationsModule } from '../integrations/integrations.module';

/**
 * L'Administration de KORVA OS: the team running the platform sees every organization, its
 * subscription and activity, and can assign a plan paid outside the platform, record such a
 * payment, or extend a trial. Imported by nothing but AppModule, so pulling in the billing and
 * subscription modules here closes no cycle.
 */
@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: Organization.name, schema: OrganizationSchema },
      { name: PlatformAdmin.name, schema: PlatformAdminSchema },
      { name: PlatformNote.name, schema: PlatformNoteSchema },
    ]),
    SubscriptionsModule,
    SubscriptionBillingModule,
    AuditModule,
    ActivationModule,
    IdentityModule,
    PlatformReviewsModule,
    FinanceModule,
    IntegrationsModule,
    // Signing keys are passed per call (PlatformAdminAuthService.signingKey): no module default.
    JwtModule.register({}),
  ],
  controllers: [
    PlatformAdminController,
    PlatformAdminAuthController,
    PlatformReviewsAdminController,
    PlatformPayoutsAdminController,
    PlatformInsightsController,
  ],
  providers: [
    PlatformAdminService,
    PlatformInsightsService,
    PlatformAdminGuard,
    PlatformAdminAuthService,
  ],
  exports: [PlatformAdminAuthService],
})
export class PlatformAdminModule {}
