import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Plan, PlanSchema } from './schemas/plan.schema';
import {
  Subscription,
  SubscriptionSchema,
} from './schemas/subscription.schema';
import { Usage, UsageSchema } from './schemas/usage.schema';

import { PlansRepository } from './plans.repository';
import { PlansService } from './plans.service';
import { SubscriptionsRepository } from './subscriptions.repository';
import { SubscriptionsService } from './subscriptions.service';
import { UsageRepository } from './usage.repository';
import { EntitlementsService } from './entitlements.service';
import { SubscriptionsController } from './subscriptions.controller';

import { IdentityModule } from '../identity/identity.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Plan.name, schema: PlanSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: Usage.name, schema: UsageSchema },
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
  ],
  exports: [PlansService, SubscriptionsService, EntitlementsService],
})
export class SubscriptionsModule {}
