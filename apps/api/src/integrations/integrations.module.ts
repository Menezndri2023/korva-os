import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  IntegrationAccount,
  IntegrationAccountSchema,
} from './schemas/integration-account.schema';
import { IntegrationsRepository } from './integrations.repository';
import { IntegrationsService } from './integrations.service';
import { INTEGRATION_ACCOUNTS_READER } from './integrations.types';
import { CredentialEncryptionModule } from '../shared/crypto/credential-encryption.module';

/**
 * Stage 1 foundation module (see docs/architecture/integrations-platform.md §2/§3/§8). Not
 * registered in app.module.ts by this lot — the orchestrator wires it in at Wave 4 convergence to
 * avoid a shared-file collision with the other Stage 1 agents (FOUND-WEBHOOK,
 * FOUND-PAYMENT-RESOLVER, FOUND-MESSAGING-FACTORY).
 *
 * Binds `INTEGRATION_ACCOUNTS_READER` (the token from integrations.types.ts) to
 * `IntegrationsRepository` itself, since the repository already implements
 * `IntegrationAccountsReader` directly — no separate adapter class needed. Other Wave 4 agents'
 * resolvers only ever need to `@Inject(INTEGRATION_ACCOUNTS_READER)`, never the repository class
 * or `IntegrationsService`.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: IntegrationAccount.name, schema: IntegrationAccountSchema },
    ]),
    CredentialEncryptionModule,
  ],
  providers: [
    IntegrationsRepository,
    IntegrationsService,
    {
      provide: INTEGRATION_ACCOUNTS_READER,
      useExisting: IntegrationsRepository,
    },
  ],
  exports: [IntegrationsService, INTEGRATION_ACCOUNTS_READER],
})
export class IntegrationsModule {}
