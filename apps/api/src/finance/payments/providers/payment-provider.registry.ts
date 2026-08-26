import { Injectable, UnprocessableEntityException } from '@nestjs/common';

import type { PaymentProvider } from './payment-provider.interface';
import { ManualPaymentProvider } from './manual-payment.provider';

type PaymentProviderFactory = () => PaymentProvider;

/**
 * Maps a provider key (an `IntegrationAccountRecord.provider` value, e.g. 'manual' |
 * 'flutterwave' | 'charibaas') to a factory that constructs the concrete `PaymentProvider`
 * adapter. `PaymentProviderResolverService` looks up the platform `IntegrationAccount` for a
 * given (role, market) pair and hands this registry the account's `provider` string — this
 * class never talks to `IntegrationAccountsReader` itself, it only knows how to turn a provider
 * key into an adapter instance.
 *
 * Stage 1 registers only `'manual'` (the existing `ManualPaymentProvider`, used as a
 * placeholder/fallback adapter for tests and for any account that intentionally settles
 * manually). Real PSP adapters (Flutterwave for Côte d'Ivoire, ChariBaaS/CMI for Morocco — see
 * docs/architecture/integrations-platform.md §4/§9) are Stage 2: adding one is a single new
 * `Map` entry here, never a refactor of this class, `PaymentProviderResolverService`, or any of
 * their callers.
 */
@Injectable()
export class PaymentProviderRegistry {
  private readonly factories = new Map<string, PaymentProviderFactory>([
    ['manual', () => new ManualPaymentProvider()],
    // Stage 2: ['flutterwave', () => new FlutterwaveProvider(...)],
    // Stage 2: ['charibaas', () => new ChariBaaSProvider(...)],
  ]);

  resolve(provider: string): PaymentProvider {
    const factory = this.factories.get(provider);
    if (!factory) {
      throw new UnprocessableEntityException({
        code: 'PAYMENT_PROVIDER_ADAPTER_NOT_REGISTERED',
        message: `No adapter is registered for payment provider "${provider}"`,
      });
    }
    return factory();
  }
}
