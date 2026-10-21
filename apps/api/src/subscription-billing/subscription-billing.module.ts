import { Module } from '@nestjs/common';

import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AuditModule } from '../audit/audit.module';
import { SubscriptionBillingController } from './subscription-billing.controller';
import { SubscriptionBillingService } from './subscription-billing.service';
import { SubscriptionAutoChargeSchedulerService } from './subscription-auto-charge-scheduler.service';

/**
 * Pairs SubscriptionsModule's invoice/subscription repositories with IntegrationsModule's
 * payment provider resolver so KORVA's own SaaS invoices ("Flow A") can actually be paid.
 *
 * This exists as its own module purely because of the import graph: SubscriptionsModule cannot
 * import IntegrationsModule (IntegrationsModule imports OrganizationsModule, which imports
 * SubscriptionsModule back — a real cycle). Importing both from a third module that nothing
 * else imports closes no cycle, so this needs no forwardRef() on either side.
 */
@Module({
  imports: [SubscriptionsModule, IntegrationsModule, AuditModule],
  controllers: [SubscriptionBillingController],
  providers: [
    SubscriptionBillingService,
    SubscriptionAutoChargeSchedulerService,
  ],
  // PlatformAdminModule records payments KORVA collected itself through settleAsPaid, the one
  // definition of "a subscription invoice got paid".
  exports: [SubscriptionBillingService],
})
export class SubscriptionBillingModule {}
