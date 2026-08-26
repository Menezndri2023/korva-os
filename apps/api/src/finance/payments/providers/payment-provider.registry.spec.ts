import { UnprocessableEntityException } from '@nestjs/common';

import { PaymentProviderRegistry } from './payment-provider.registry';
import { ManualPaymentProvider } from './manual-payment.provider';

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

  it('throws a typed error for an unregistered provider key', () => {
    const registry = new PaymentProviderRegistry();

    expect(() => registry.resolve('flutterwave')).toThrow(
      UnprocessableEntityException,
    );
    expect(() => registry.resolve('flutterwave')).toThrow(
      /No adapter is registered for payment provider "flutterwave"/,
    );
  });
});
