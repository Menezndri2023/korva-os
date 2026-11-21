import { Injectable, UnprocessableEntityException } from '@nestjs/common';

import type { PaymentProvider } from './payment-provider.interface';
import { ManualPaymentProvider } from './manual-payment.provider';
import { FlutterwaveProvider } from './flutterwave-payment.provider';
import { PaystackProvider } from './paystack-payment.provider';
import { GeniusPayProvider } from './geniuspay-payment.provider';
import { SasPayProvider } from './saspay-payment.provider';

/**
 * `secret` is the platform `IntegrationAccount`'s decrypted credential (see
 * `PaymentProviderResolverService`, which is the only caller and the only class allowed to have
 * asked `IntegrationsService.getDecryptedPlatformSecret` for it) — `null` for a provider that
 * genuinely has none (e.g. `'manual'`, which never calls a real API). Each factory decides for
 * itself whether a missing secret is acceptable; the registry does not assume every provider
 * needs one.
 */
type PaymentProviderFactory = (secret: string | null) => PaymentProvider;

/**
 * Maps a provider key (an `IntegrationAccountRecord.provider` value, e.g. 'manual' |
 * 'flutterwave' | 'charibaas') to a factory that constructs the concrete `PaymentProvider`
 * adapter, given that platform account's decrypted secret. `PaymentProviderResolverService`
 * looks up the platform `IntegrationAccount` for a given (role, market) pair, decrypts its
 * secret, and hands both the account's `provider` string and the secret to this registry — this
 * class never talks to `IntegrationAccountsReader`/`IntegrationsService` itself, it only knows
 * how to turn a provider key + secret into an adapter instance.
 *
 * Stage 1 registered only `'manual'` (the existing `ManualPaymentProvider`, used as a
 * placeholder/fallback adapter for tests and for any account that intentionally settles
 * manually). Stage 2 (PAY-FLUTTERWAVE) added `'flutterwave'`. Stage 2.2 closed the gap Stage 2
 * left open on purpose: this registry's factory now genuinely receives and uses the decrypted
 * secret instead of a hardcoded `''` placeholder — a platform account with no secret stored
 * (`secret === null`) is treated as a missing-credential condition for a credential-requiring
 * provider and fails closed with a typed error, never silently constructing an adapter that
 * would send `Authorization: Bearer ` (undefined/empty) to a real API. `'paystack'` (added per
 * docs/BUSINESS_OS_AUDIT.md §6: "despite the abstraction being ready, only Flutterwave has a
 * real adapter") follows the exact same `requireSecret` guard.
 */
@Injectable()
export class PaymentProviderRegistry {
  private readonly factories = new Map<string, PaymentProviderFactory>([
    ['manual', () => new ManualPaymentProvider()],
    ['flutterwave', (secret) => new FlutterwaveProvider(requireSecret(secret))],
    ['paystack', (secret) => new PaystackProvider(requireSecret(secret))],
    // Mobile money (Wave, Orange Money, MTN, Moov) and cards in West/Central Africa. Its secret is
    // the "pk_… sk_…" pair — see geniuspay-payment.provider.ts.
    ['geniuspay', (secret) => new GeniusPayProvider(requireSecret(secret))],
    // Mobile money in 18 countries, cards (in USD) and an API for withdrawals. Its secret is one
    // sk_live_…/sk_test_… key, refused on the wrong host — see saspay-payment.provider.ts.
    ['saspay', (secret) => new SasPayProvider(requireSecret(secret))],
    // Stage 2: ['charibaas', (secret) => new ChariBaaSProvider(requireSecret(secret))],
  ]);

  resolve(provider: string, secret: string | null): PaymentProvider {
    const factory = this.factories.get(provider);
    if (!factory) {
      throw new UnprocessableEntityException({
        code: 'PAYMENT_PROVIDER_ADAPTER_NOT_REGISTERED',
        message: `No adapter is registered for payment provider "${provider}"`,
      });
    }
    return factory(secret);
  }
}

/** Shared fail-closed guard for any factory whose adapter genuinely needs a bearer credential —
 *  throws rather than ever letting a factory construct an adapter with `''`/`undefined`, which
 *  would otherwise silently send `Authorization: Bearer` with no real value on every request. */
function requireSecret(secret: string | null): string {
  if (!secret) {
    throw new UnprocessableEntityException({
      code: 'PAYMENT_PROVIDER_CREDENTIAL_MISSING',
      message:
        'This payment provider is configured but has no credential stored — cannot construct a working adapter',
    });
  }
  return secret;
}
