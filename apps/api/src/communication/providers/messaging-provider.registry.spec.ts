import { UnprocessableEntityException } from '@nestjs/common';

import { MessagingProviderRegistry } from './messaging-provider.registry';
import { ThreeSixtyDialogProvider } from './three-sixty-dialog.provider';

describe('MessagingProviderRegistry', () => {
  it('returns a ThreeSixtyDialogProvider instance constructed with the real decrypted secret', () => {
    const registry = new MessagingProviderRegistry();

    const provider = registry.resolve('360dialog', 'TEST_360DIALOG_SECRET_A');

    expect(provider).toBeInstanceOf(ThreeSixtyDialogProvider);
    expect(provider.name).toBe('360dialog');
    expect((provider as unknown as { apiKey: string }).apiKey).toBe(
      'TEST_360DIALOG_SECRET_A',
    );
  });

  it('returns a fresh instance on each resolve call', () => {
    const registry = new MessagingProviderRegistry();

    const first = registry.resolve('360dialog', 'TEST_360DIALOG_SECRET_A');
    const second = registry.resolve('360dialog', 'TEST_360DIALOG_SECRET_A');

    expect(first).not.toBe(second);
  });

  it('fails closed with a typed error when resolving "360dialog" with a null secret (missing credential)', () => {
    const registry = new MessagingProviderRegistry();

    expect(() => registry.resolve('360dialog', null)).toThrow(
      UnprocessableEntityException,
    );
    expect(() => registry.resolve('360dialog', null)).toThrow(/credential/i);
  });

  it('fails closed with a typed error when resolving "360dialog" with an empty-string secret', () => {
    const registry = new MessagingProviderRegistry();

    expect(() => registry.resolve('360dialog', '')).toThrow(
      UnprocessableEntityException,
    );
  });

  it('throws a typed error for an unregistered provider key', () => {
    const registry = new MessagingProviderRegistry();

    expect(() => registry.resolve('twilio', 'anything')).toThrow(
      UnprocessableEntityException,
    );
    expect(() => registry.resolve('twilio', 'anything')).toThrow(
      /No adapter is registered for messaging provider "twilio"/,
    );
  });
});
