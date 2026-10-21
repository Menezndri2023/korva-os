import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Organization,
  OrganizationSchema,
} from '../organizations/schemas/organization.schema';
import { User, UserSchema } from '../identity/schemas/user.schema';
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
      { name: User.name, schema: UserSchema },
    ]),
    SubscriptionsModule,
    SubscriptionBillingModule,
    AuditModule,
    ActivationModule,
    IdentityModule,
  ],
  controllers: [PlatformAdminController],
  providers: [PlatformAdminService, PlatformAdminGuard],
})
export class PlatformAdminModule {}
