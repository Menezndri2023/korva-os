import { Injectable, UnprocessableEntityException } from '@nestjs/common';

import type { PaymentProvider } from './payment-provider.interface';
import { ManualPaymentProvider } from './manual-payment.provider';
import { FlutterwaveProvider } from './flutterwave-payment.provider';

type PaymentProviderFactory = () => PaymentProvider;

/**
 * Maps a provider key (an `IntegrationAccountRecord.provider` value, e.g. 'manual' |
 * 'flutterwave' | 'charibaas') to a factory that constructs the concrete `PaymentProvider`
 * adapter. `PaymentProviderResolverService` looks up the platform `IntegrationAccount` for a
 * given (role, market) pair and hands this registry the account's `provider` string — this
 * class never talks to `IntegrationAccountsReader` itself, it only knows how to turn a provider
 * key into an adapter instance.
 *
 * Stage 1 registered only `'manual'` (the existing `ManualPaymentProvider`, used as a
 * placeholder/fallback adapter for tests and for any account that intentionally settles
 * manually). Stage 2 (PAY-FLUTTERWAVE) adds `'flutterwave'` here as the single new `Map` entry
 * the Stage 1 design predicted — no refactor of this class, `PaymentProviderResolverService`, or
 * any of their callers.
 *
 * NOTE on the `'flutterwave'` factory below: this registry's factory signature (`() =>
 * PaymentProvider`) takes no arguments, so there is no per-call context to plumb a decrypted
 * secret key through yet — wiring a real key from `IntegrationsService`'s decrypt path
 * (docs/architecture/integrations-platform.md §3) into this factory is explicitly out of scope
 * for this lot (see `FlutterwaveProvider`'s own class doc comment). The empty-string placeholder
 * below makes the adapter constructible and registered, exactly as this lot's mandate requires;
 * any real call made through it before that wiring lands will correctly fail Flutterwave's own
 * authentication check (HTTP 401) rather than silently pretending to work.
 */
@Injectable()
export class PaymentProviderRegistry {
  private readonly factories = new Map<string, PaymentProviderFactory>([
    ['manual', () => new ManualPaymentProvider()],
    ['flutterwave', () => new FlutterwaveProvider('')],
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
