import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Plan, PlanSchema } from './schemas/plan.schema';
import {
  Subscription,
  SubscriptionSchema,
} from './schemas/subscription.schema';
import { Usage, UsageSchema } from './schemas/usage.schema';
import {
  Organization,
  OrganizationSchema,
} from '../organizations/schemas/organization.schema';

import { PlansRepository } from './plans.repository';
import { PlansService } from './plans.service';
import { SubscriptionsRepository } from './subscriptions.repository';
import { SubscriptionsService } from './subscriptions.service';
import { UsageRepository } from './usage.repository';
import { EntitlementsService } from './entitlements.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionPeriodSchedulerService } from './subscription-period-scheduler.service';

import { IdentityModule } from '../identity/identity.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Plan.name, schema: PlanSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: Usage.name, schema: UsageSchema },
      // Registered here (not via OrganizationsModule) so changePlan can trim enabledModules on
      // downgrade — OrganizationsModule already imports SubscriptionsModule, so depending on
      // OrganizationsModule/OrganizationsRepository here would be circular.
      { name: Organization.name, schema: OrganizationSchema },
    ]),
    IdentityModule,
    AuditModule,
  ],
  controllers: [SubscriptionsController],
  providers: [
    PlansRepository,
    PlansService,
    SubscriptionsRepository,
    SubscriptionsService,
    UsageRepository,
    EntitlementsService,
    SubscriptionPeriodSchedulerService,
  ],
  exports: [PlansService, SubscriptionsService, EntitlementsService],
})
export class SubscriptionsModule {}
