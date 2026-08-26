import { UnprocessableEntityException } from '@nestjs/common';

import { PaymentProviderRegistry } from './payment-provider.registry';
import { ManualPaymentProvider } from './manual-payment.provider';
import { FlutterwaveProvider } from './flutterwave-payment.provider';

describe('PaymentProviderRegistry', () => {
  it('returns a ManualPaymentProvider instance for the known "manual" key', () => {
    const registry = new PaymentProviderRegistry();

    const provider = registry.resolve('manual');

    expect(provider).toBeInstanceOf(ManualPaymentProvider);
    expect(provider.name).toBe('manual');
  });

  it('returns a fresh instance on each resolve call', () => {
    const registry = new PaymentProviderRegistry();

    const first = registry.resolve('manual');
    const second = registry.resolve('manual');

    expect(first).not.toBe(second);
  });

  // Wave 4 Stage 2 (PAY-FLUTTERWAVE): proves the registry's one-line addition actually resolves
  // to the real adapter, not just a Map entry that happens to exist.
  it('returns a FlutterwaveProvider instance for the "flutterwave" key', () => {
    const registry = new PaymentProviderRegistry();

    const provider = registry.resolve('flutterwave');

    expect(provider).toBeInstanceOf(FlutterwaveProvider);
    expect(provider.name).toBe('flutterwave');
  });

  it('returns a fresh FlutterwaveProvider instance on each resolve call', () => {
    const registry = new PaymentProviderRegistry();

    const first = registry.resolve('flutterwave');
    const second = registry.resolve('flutterwave');

    expect(first).not.toBe(second);
  });

  it('throws a typed error for an unregistered provider key', () => {
    const registry = new PaymentProviderRegistry();

    expect(() => registry.resolve('charibaas')).toThrow(
      UnprocessableEntityException,
    );
    expect(() => registry.resolve('charibaas')).toThrow(
      /No adapter is registered for payment provider "charibaas"/,
    );
  });
});
