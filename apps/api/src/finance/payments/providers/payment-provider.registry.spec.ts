import { UnprocessableEntityException } from '@nestjs/common';

import { PaymentProviderRegistry } from './payment-provider.registry';
import { ManualPaymentProvider } from './manual-payment.provider';
import { FlutterwaveProvider } from './flutterwave-payment.provider';
import { PaystackProvider } from './paystack-payment.provider';

describe('PaymentProviderRegistry', () => {
  it('returns a ManualPaymentProvider instance for the known "manual" key regardless of secret', () => {
    const registry = new PaymentProviderRegistry();

    const provider = registry.resolve('manual', null);

    expect(provider).toBeInstanceOf(ManualPaymentProvider);
    expect(provider.name).toBe('manual');
  });

  it('returns a fresh instance on each resolve call', () => {
    const registry = new PaymentProviderRegistry();

    const first = registry.resolve('manual', null);
    const second = registry.resolve('manual', null);

    expect(first).not.toBe(second);
  });

  // Stage 2.2 (credential wiring): proves the registry genuinely threads a real secret through
  // to the constructed adapter, not just that the key resolves to the right class.
  it('returns a FlutterwaveProvider instance constructed with the real decrypted secret', () => {
    const registry = new PaymentProviderRegistry();

    const provider = registry.resolve('flutterwave', 'flw-real-secret-key');

    expect(provider).toBeInstanceOf(FlutterwaveProvider);
    expect(provider.name).toBe('flutterwave');
    expect((provider as unknown as { secretKey: string }).secretKey).toBe(
      'flw-real-secret-key',
    );
  });

  it('returns a fresh FlutterwaveProvider instance on each resolve call', () => {
    const registry = new PaymentProviderRegistry();

    const first = registry.resolve('flutterwave', 'flw-real-secret-key');
    const second = registry.resolve('flutterwave', 'flw-real-secret-key');

    expect(first).not.toBe(second);
  });

  // Stage 2.2: the core fail-closed proof — a platform account with no stored secret must never
  // silently produce a working-looking FlutterwaveProvider('').
  it('fails closed with a typed error when resolving "flutterwave" with a null secret (missing credential)', () => {
    const registry = new PaymentProviderRegistry();

    expect(() => registry.resolve('flutterwave', null)).toThrow(
      UnprocessableEntityException,
    );
    expect(() => registry.resolve('flutterwave', null)).toThrow(/credential/i);
  });

  it('fails closed with a typed error when resolving "flutterwave" with an empty-string secret', () => {
    const registry = new PaymentProviderRegistry();

    expect(() => registry.resolve('flutterwave', '')).toThrow(
      UnprocessableEntityException,
    );
  });

  // docs/BUSINESS_OS_AUDIT.md §6: a second real adapter, same credential-wiring/fail-closed
  // guarantees as Flutterwave's own coverage above.
  it('returns a PaystackProvider instance constructed with the real decrypted secret', () => {
    const registry = new PaymentProviderRegistry();

    const provider = registry.resolve('paystack', 'sk-real-secret-key');

    expect(provider).toBeInstanceOf(PaystackProvider);
    expect(provider.name).toBe('paystack');
    expect((provider as unknown as { secretKey: string }).secretKey).toBe(
      'sk-real-secret-key',
    );
  });

  it('fails closed with a typed error when resolving "paystack" with a null secret (missing credential)', () => {
    const registry = new PaymentProviderRegistry();

    expect(() => registry.resolve('paystack', null)).toThrow(
      UnprocessableEntityException,
    );
    expect(() => registry.resolve('paystack', null)).toThrow(/credential/i);
  });

  it('throws a typed error for an unregistered provider key', () => {
    const registry = new PaymentProviderRegistry();

    expect(() => registry.resolve('charibaas', 'anything')).toThrow(
      UnprocessableEntityException,
    );
    expect(() => registry.resolve('charibaas', 'anything')).toThrow(
      /No adapter is registered for payment provider "charibaas"/,
    );
  });
});
