import {
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';

import {
  INTEGRATION_ACCOUNTS_READER,
  type IntegrationAccountsReader,
} from '../../integrations/integrations.types';
import { IntegrationsService } from '../../integrations/integrations.service';
import type { MessagingProvider } from './messaging-provider.interface';
import { MessagingProviderRegistry } from './messaging-provider.registry';

export interface ResolveMessagingAccountInput {
  organizationId: string;
  /** e.g. '360dialog' — the WhatsApp BSP provider key the tenant is expected to have connected. */
  provider: string;
}

export interface ResolveMessagingAccountForTestInput {
  organizationId: string;
  /** The specific IntegrationAccount id being tested — NOT looked up by (organizationId,
   *  provider) like the other methods, since a still-`pending` account must be resolvable by its
   *  own id regardless of status (see `resolveForTest`'s own doc comment). */
  accountId: string;
  provider: string;
}

/**
 * Per docs/architecture/integrations-platform.md §5, extended in Stage 2.4 to close the gap its
 * own doc comment used to describe: `assertTenantConnected` only ever answered "is this tenant
 * allowed to send via this provider right now?" — it never returned an actual, usably-configured
 * `MessagingProvider` instance, so every real send path (`ConversationsService`) had no choice but
 * to fall back to the single, GLOBAL `MESSAGING_PROVIDER` binding (`MessagingProviderModule`,
 * driven by the process-wide `WHATSAPP_API_KEY` env var) — the same credential for every tenant,
 * unacceptable for a multi-tenant SaaS (see this service's class-level Stage 2.4 note below).
 *
 * `resolveTenantProvider` closes that gap, mirroring `PaymentProviderResolverService`'s own
 * pattern exactly (look up the tenant's own `IntegrationAccount` via the secret-free
 * `IntegrationAccountsReader`, decrypt its secret through `IntegrationsService`'s narrow, audited
 * path, hand both to a registry) — but as a genuinely separate class/pipeline from the payment
 * side, per the Stage 2.4 mandate ("ils peuvent partager les primitives de credential existantes
 * mais ne doivent pas être fusionnés"): `MessagingProviderRegistry` is its own class, this service
 * is its own service, neither imports the other's resolver/registry.
 *
 * `assertTenantConnected` is kept, unchanged, for callers that only need the boolean-style check
 * (none remain internally after this stage's `ConversationsService` rewiring, but it stays a
 * valid, cheaper call for any future caller that only needs a yes/no).
 */
@Injectable()
export class MessagingProviderResolverService {
  constructor(
    @Inject(INTEGRATION_ACCOUNTS_READER)
    private readonly integrationAccountsReader: IntegrationAccountsReader,
    private readonly integrationsService: IntegrationsService,
    private readonly registry: MessagingProviderRegistry,
  ) {}

  async assertTenantConnected(
    input: ResolveMessagingAccountInput,
  ): Promise<void> {
    const { organizationId, provider } = input;

    const account = await this.integrationAccountsReader.findTenantAccount({
      organizationId,
      domain: 'messaging',
      provider,
    });

    if (!account || account.status !== 'active') {
      throw new UnprocessableEntityException({
        code: 'WHATSAPP_NOT_CONNECTED',
        message: `Organization "${organizationId}" has no active "${provider}" messaging integration connected`,
      });
    }
  }

  /**
   * Resolves a real, tenant-scoped `MessagingProvider` instance for `input.organizationId` — the
   * ONLY sanctioned way to obtain a working WhatsApp adapter for a specific tenant. Never falls
   * back to the global `MESSAGING_PROVIDER` binding: a tenant with no active `IntegrationAccount`
   * fails closed with the same typed `WHATSAPP_NOT_CONNECTED` error `assertTenantConnected` already
   * used (no fake completeness, no silent cross-tenant credential reuse — see this file's class
   * doc and docs/architecture/integrations-platform.md's Stage 2.4 addendum).
   *
   * `account` (from `IntegrationAccountsReader`) is deliberately secret-free — the decrypted
   * secret can only be obtained through `IntegrationsService.getDecryptedTenantSecret`, which
   * itself re-verifies `organizationId` ownership in the same DB query, not as a separate
   * after-the-fact check.
   */
  async resolveTenantProvider(
    input: ResolveMessagingAccountInput,
  ): Promise<MessagingProvider> {
    const { organizationId, provider } = input;

    const account = await this.integrationAccountsReader.findTenantAccount({
      organizationId,
      domain: 'messaging',
      provider,
    });

    if (!account || account.status !== 'active') {
      throw new UnprocessableEntityException({
        code: 'WHATSAPP_NOT_CONNECTED',
        message: `Organization "${organizationId}" has no active "${provider}" messaging integration connected`,
      });
    }

    const secret = await this.integrationsService.getDecryptedTenantSecret(
      organizationId,
      account.id,
    );

    return this.registry.resolve(account.provider, secret);
  }

  /**
   * The bootstrap-safe counterpart to `resolveTenantProvider`, used ONLY by
   * `IntegrationsController.testConnection` — deliberately does NOT require `status === 'active'`
   * first. `resolveTenantProvider` (the real-send path) must stay strictly gated on `active` so a
   * pending/unverified account can never be used to actually send a message; but that same gate
   * would make a freshly `connectMessaging`'d account impossible to ever test (test-connection is
   * the only mechanism that promotes `pending` → `active` — see
   * `IntegrationsService.recordTenantAccountTestConnection`), so this method resolves a real
   * provider instance straight from the account's own id, decrypting whatever secret was stored
   * at connect time. `IntegrationsService.getDecryptedTenantSecret` still re-verifies
   * `organizationId` ownership in the same DB query (never trusts `accountId` alone), and the
   * registry's own `requireSecret` still fails closed with `MESSAGING_PROVIDER_CREDENTIAL_MISSING`
   * if no secret was ever attached to the account — so an account that skipped
   * `connectMessaging`'s required `apiKey` (or was created before it existed) fails the test with
   * a typed error rather than a fake success, exactly like a wrong/expired real credential would.
   */
  async resolveForTest(
    input: ResolveMessagingAccountForTestInput,
  ): Promise<MessagingProvider> {
    const { organizationId, accountId, provider } = input;

    const secret = await this.integrationsService.getDecryptedTenantSecret(
      organizationId,
      accountId,
    );

    return this.registry.resolve(provider, secret);
  }
}
