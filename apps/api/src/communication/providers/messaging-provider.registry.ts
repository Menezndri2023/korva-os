import { Injectable, UnprocessableEntityException } from '@nestjs/common';

import type { MessagingProvider } from './messaging-provider.interface';
import { ThreeSixtyDialogProvider } from './three-sixty-dialog.provider';

/**
 * `secret` is the tenant `IntegrationAccount`'s decrypted credential (see
 * `MessagingProviderResolverService`, the only caller and the only class allowed to have asked
 * `IntegrationsService.getDecryptedTenantSecret` for it) — mirrors
 * `PaymentProviderRegistry`'s own factory contract exactly (Stage 2.2), applied to messaging.
 * Deliberately a SEPARATE class/instance from `PaymentProviderRegistry`, not a shared/merged one
 * — per the Stage 2.4 mandate, payment and messaging resolution share the same credential
 * primitives (`IntegrationAccount`, `CredentialEncryptionService`) but stay architecturally
 * distinct services.
 */
type MessagingProviderFactory = (secret: string | null) => MessagingProvider;

@Injectable()
export class MessagingProviderRegistry {
  private readonly factories = new Map<string, MessagingProviderFactory>([
    [
      '360dialog',
      (secret) => new ThreeSixtyDialogProvider(requireSecret(secret)),
    ],
  ]);

  resolve(provider: string, secret: string | null): MessagingProvider {
    const factory = this.factories.get(provider);
    if (!factory) {
      throw new UnprocessableEntityException({
        code: 'MESSAGING_PROVIDER_ADAPTER_NOT_REGISTERED',
        message: `No adapter is registered for messaging provider "${provider}"`,
      });
    }
    return factory(secret);
  }
}

/** Fail-closed guard, same shape as `payment-provider.registry.ts`'s own `requireSecret` — never
 *  lets a factory construct an adapter with `''`/`undefined`, which would otherwise silently send
 *  `D360-API-KEY:` with no real value on every request. */
function requireSecret(secret: string | null): string {
  if (!secret) {
    throw new UnprocessableEntityException({
      code: 'MESSAGING_PROVIDER_CREDENTIAL_MISSING',
      message:
        'This messaging provider is configured but has no credential stored — cannot construct a working adapter',
    });
  }
  return secret;
}
