import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  IntegrationAccount,
  IntegrationAccountSchema,
} from './schemas/integration-account.schema';
import { IntegrationsRepository } from './integrations.repository';
import { IntegrationsService } from './integrations.service';
import { IntegrationsController } from './integrations.controller';
import { INTEGRATION_ACCOUNTS_READER } from './integrations.types';
import { CredentialEncryptionModule } from '../shared/crypto/credential-encryption.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PaymentProviderResolverService } from '../finance/payments/providers/payment-provider-resolver.service';
import { PaymentProviderRegistry } from '../finance/payments/providers/payment-provider.registry';
import { MessagingProviderResolverService } from '../communication/providers/messaging-provider-resolver.service';
import { MessagingProviderRegistry } from '../communication/providers/messaging-provider.registry';

/**
 * Registered in app.module.ts as of Wave 4 Stage 2, once `IntegrationsController` gave this
 * module a real HTTP surface (see docs/architecture/integrations-platform.md §2/§3/§8 for Stage 1
 * design, §8/As-Built for the Stage 2 additions).
 *
 * `PaymentProviderResolverService`/`PaymentProviderRegistry`/`MessagingProviderResolverService`/
 * `MessagingProviderRegistry` are provided HERE rather than in `FinanceModule`/
 * `CommunicationModule` (where they might seem to belong domain-wise) because the two resolvers
 * depend on `INTEGRATION_ACCOUNTS_READER`, which only this module provides — importing
 * `FinanceModule`/`CommunicationModule` from here to get them back out would create a circular
 * module dependency (confirmed at boot: `UnknownDependenciesException: Nest can't resolve
 * dependencies of the PaymentProviderResolverService (?, OrganizationsService,
 * PaymentProviderRegistry)... available in the FinanceModule module` — the first, incorrect wiring
 * attempt). Only `OrganizationsModule` is imported for real (for `PaymentProviderResolverService`'s
 * `OrganizationsService` dependency) — that module has no dependency back on this one, so it's not
 * circular. `MessagingProviderResolverService` is exported (Stage 2.4) so `CommunicationModule` can
 * import this module and inject it into `ConversationsService` — safe, one-directional, since
 * `IntegrationsModule` still imports nothing from `CommunicationModule`.
 *
 * Binds `INTEGRATION_ACCOUNTS_READER` (the token from integrations.types.ts) to
 * `IntegrationsRepository` itself, since the repository already implements
 * `IntegrationAccountsReader` directly — no separate adapter class needed.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: IntegrationAccount.name, schema: IntegrationAccountSchema },
    ]),
    CredentialEncryptionModule,
    OrganizationsModule,
  ],
  controllers: [IntegrationsController],
  providers: [
    IntegrationsRepository,
    IntegrationsService,
    {
      provide: INTEGRATION_ACCOUNTS_READER,
      useExisting: IntegrationsRepository,
    },
    PaymentProviderResolverService,
    PaymentProviderRegistry,
    MessagingProviderResolverService,
    MessagingProviderRegistry,
  ],
  exports: [
    IntegrationsService,
    INTEGRATION_ACCOUNTS_READER,
    MessagingProviderResolverService,
  ],
})
export class IntegrationsModule {}
