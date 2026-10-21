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
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformAdminService } from './platform-admin.service';

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
    ]),
    SubscriptionsModule,
    SubscriptionBillingModule,
    AuditModule,
    ActivationModule,
    IdentityModule,
    // Signing keys are passed per call (PlatformAdminAuthService.signingKey): no module default.
    JwtModule.register({}),
  ],
  controllers: [PlatformAdminController, PlatformAdminAuthController],
  providers: [
    PlatformAdminService,
    PlatformAdminGuard,
    PlatformAdminAuthService,
  ],
  exports: [PlatformAdminAuthService],
})
export class PlatformAdminModule {}
