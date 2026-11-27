import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Plan, PlanSchema } from './schemas/plan.schema';
import {
  Subscription,
  SubscriptionSchema,
} from './schemas/subscription.schema';
import { Usage, UsageSchema } from './schemas/usage.schema';
import {
  SubscriptionInvoice,
  SubscriptionInvoiceSchema,
} from './schemas/subscription-invoice.schema';
import {
  PaymentMandate,
  PaymentMandateSchema,
} from './schemas/payment-mandate.schema';
import {
  Organization,
  OrganizationSchema,
} from '../organizations/schemas/organization.schema';

import { PlansRepository } from './plans.repository';
import { PlansService } from './plans.service';
import { SubscriptionsRepository } from './subscriptions.repository';
import { SubscriptionInvoicesRepository } from './subscription-invoices.repository';
import { PaymentMandatesRepository } from './payment-mandates.repository';
import { SubscriptionsService } from './subscriptions.service';
import { UsageRepository } from './usage.repository';
import { EntitlementsService } from './entitlements.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionPeriodSchedulerService } from './subscription-period-scheduler.service';

import { IdentityModule } from '../identity/identity.module';
import { AuditModule } from '../audit/audit.module';
// Numbers SubscriptionInvoices ('ABO-0001') with the same per-organization atomic counter
// InvoicesService already uses for 'FAC-0001'. CountersModule is a leaf core module — importing
// it here adds no cycle.
import { CountersModule } from '../core/counters/counters.module';
// PaymentMandatesRepository encrypts stored authorizations under the same AES-256-GCM key as
// IntegrationAccount credentials. A leaf module, so no cycle.
import { CredentialEncryptionModule } from '../shared/crypto/credential-encryption.module';

import { DocumentsModule } from '../documents/documents.module';
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Plan.name, schema: PlanSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: Usage.name, schema: UsageSchema },
      { name: SubscriptionInvoice.name, schema: SubscriptionInvoiceSchema },
      { name: PaymentMandate.name, schema: PaymentMandateSchema },
      // Registered here (not via OrganizationsModule) so changePlan can trim enabledModules on
      // downgrade — OrganizationsModule already imports SubscriptionsModule, so depending on
      // OrganizationsModule/OrganizationsRepository here would be circular.
      { name: Organization.name, schema: OrganizationSchema },
    ]),
    IdentityModule,
    AuditModule,
    CountersModule,
    CredentialEncryptionModule,
    DocumentsModule,
  ],
  controllers: [SubscriptionsController],
  providers: [
    PlansRepository,
    PlansService,
    SubscriptionsRepository,
    SubscriptionInvoicesRepository,
    PaymentMandatesRepository,
    SubscriptionsService,
    UsageRepository,
    EntitlementsService,
    SubscriptionPeriodSchedulerService,
  ],
  exports: [
    PlansService,
    SubscriptionsService,
    EntitlementsService,
    // Consumed by SubscriptionBillingModule, which pairs it with IntegrationsModule's payment
    // provider resolver. That lives in its own module rather than here because
    // SubscriptionsModule cannot import IntegrationsModule: IntegrationsModule imports
    // OrganizationsModule, which imports this module back.
    SubscriptionInvoicesRepository,
    SubscriptionsRepository,
    PaymentMandatesRepository,
  ],
})
export class SubscriptionsModule {}
