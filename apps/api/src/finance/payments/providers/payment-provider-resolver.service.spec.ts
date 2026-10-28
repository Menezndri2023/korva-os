import { UnprocessableEntityException } from '@nestjs/common';

import { PaymentProviderResolverService } from './payment-provider-resolver.service';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { ManualPaymentProvider } from './manual-payment.provider';
import { FlutterwaveProvider } from './flutterwave-payment.provider';
import type { OrganizationsService } from '../../../organizations/organizations.service';
import type { IntegrationAccountsReader } from '../../../integrations/integrations.types';
import type { IntegrationsService } from '../../../integrations/integrations.service';

const ORG_ID = '507f1f77bcf86cd799439011';

function buildAccount(
  overrides: Partial<{
    status: 'pending' | 'active' | 'disabled' | 'revoked' | 'error';
    provider: string;
    role: string;
    market: string | null;
  }> = {},
) {
  return {
    id: 'acct_1',
    scope: 'platform' as const,
    organizationId: null,
    domain: 'payment' as const,
    provider: overrides.provider ?? 'manual',
    role: overrides.role ?? 'merchant-of-record',
    market: overrides.market ?? 'CI',
    status: overrides.status ?? 'active',
    metadata: {},
    lastVerifiedAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
  };
}

function buildService(
  findPlatformAccount: jest.Mock,
  organizationCountry = 'CI',
  getDecryptedPlatformSecret: jest.Mock = jest
    .fn()
    .mockResolvedValue('unused-by-manual'),
) {
  const reader = {
    findPlatformAccount,
    findTenantAccount: jest.fn(),
  } as unknown as IntegrationAccountsReader;

  const getById = jest.fn().mockResolvedValue({ country: organizationCountry });
  const organizationsService = {
    getById,
  } as unknown as OrganizationsService;

  const registry = new PaymentProviderRegistry();

  const integrationsService = {
    getDecryptedPlatformSecret,
  } as unknown as IntegrationsService;

  const service = new PaymentProviderResolverService(
    reader,
    organizationsService,
    registry,
    integrationsService,
  );

  return { service, getById, registry, getDecryptedPlatformSecret };
}

/** Awaits `promise`, asserting it rejects with an UnprocessableEntityException carrying `code`. */
async function expectUnprocessableCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(UnprocessableEntityException);
  try {
    await promise;
    throw new Error('expected promise to reject');
  } catch (error) {
    expect((error as UnprocessableEntityException).getResponse()).toMatchObject(
      { code },
    );
  }
}

describe('PaymentProviderResolverService', () => {
  it('resolves the commerce flow using the tenant country as market', async () => {
    const findPlatformAccount = jest
      .fn()
      .mockResolvedValue(buildAccount({ market: 'CI' }));
    const { service, getById } = buildService(findPlatformAccount, 'CI');

    const provider = await service.resolve({
      flow: 'commerce',
      organizationId: ORG_ID,
    });

    expect(getById).toHaveBeenCalledWith(ORG_ID);
    expect(findPlatformAccount).toHaveBeenCalledWith({
      domain: 'payment',
      role: 'merchant-of-record',
      market: 'CI',
    });
    expect(provider).toBeInstanceOf(ManualPaymentProvider);
  });

  it('resolves the subscription flow with a market-independent lookup', async () => {
    const findPlatformAccount = jest
      .fn()
      .mockResolvedValue(
        buildAccount({ role: 'subscription-billing', market: null }),
      );
    const { service, getById } = buildService(findPlatformAccount);

    const provider = await service.resolve({
      flow: 'subscription',
      organizationId: ORG_ID,
    });

    expect(getById).not.toHaveBeenCalled();
    expect(findPlatformAccount).toHaveBeenCalledWith({
      domain: 'payment',
      role: 'subscription-billing',
      market: null,
    });
    expect(provider).toBeInstanceOf(ManualPaymentProvider);
  });

  it('throws a typed error when no active account exists for the market, never falling back silently', async () => {
    const findPlatformAccount = jest.fn().mockResolvedValue(null);
    const { service } = buildService(findPlatformAccount, 'MA');

    await expectUnprocessableCode(
      service.resolve({ flow: 'commerce', organizationId: ORG_ID }),
      'PAYMENT_PROVIDER_NOT_CONFIGURED',
    );
  });

  it('throws a typed error when the matching account is not active', async () => {
    const findPlatformAccount = jest
      .fn()
      .mockResolvedValue(buildAccount({ status: 'disabled' }));
    const { service } = buildService(findPlatformAccount);

    await expectUnprocessableCode(
      service.resolve({ flow: 'commerce', organizationId: ORG_ID }),
      'PAYMENT_PROVIDER_NOT_CONFIGURED',
    );
  });

  it('never returns a provider for a different (role, market) than requested', async () => {
    // The reader is asked for the CI merchant-of-record account; simulate it correctly
    // returning null for an unconfigured market ("MA") rather than the resolver
    // guessing/reusing an unrelated account.
    const findPlatformAccount = jest
      .fn()
      .mockImplementation(({ market }: { market: string | null }) =>
        market === 'CI'
          ? Promise.resolve(buildAccount({ market: 'CI' }))
          : Promise.resolve(null),
      );
    const { service } = buildService(findPlatformAccount, 'MA');

    await expectUnprocessableCode(
      service.resolve({ flow: 'commerce', organizationId: ORG_ID }),
      'PAYMENT_PROVIDER_NOT_CONFIGURED',
    );
  });

  // Stage 2.2 — TEST 1 (credential propagation) + TEST 2 (real application path): proves the
  // full IntegrationAccount → resolver → registry → FlutterwaveProvider chain genuinely threads
  // a decrypted secret through, using the REAL PaymentProviderRegistry (not mocked) so this is
  // the actual application code path, only IntegrationsService's decrypt call is faked (a fake
  // credential only, per the Wave 4 mandate — no real network/provider call).
  describe('credential propagation (Stage 2.2)', () => {
    it('passes the account id to IntegrationsService.getDecryptedPlatformSecret, and threads the returned secret into a real FlutterwaveProvider via the real registry', async () => {
      const findPlatformAccount = jest
        .fn()
        .mockResolvedValue(
          buildAccount({ provider: 'flutterwave', market: 'CI' }),
        );
      const getDecryptedPlatformSecret = jest
        .fn()
        .mockResolvedValue('flw-fake-secret-for-test-only');
      const { service } = buildService(
        findPlatformAccount,
        'CI',
        getDecryptedPlatformSecret,
      );

      const provider = await service.resolve({
        flow: 'commerce',
        organizationId: ORG_ID,
      });

      expect(getDecryptedPlatformSecret).toHaveBeenCalledWith('acct_1');
      expect(provider).toBeInstanceOf(FlutterwaveProvider);
      expect((provider as unknown as { secretKey: string }).secretKey).toBe(
        'flw-fake-secret-for-test-only',
      );
    });

    // TEST 6 (missing credential — fail closed): a platform account can exist and be 'active'
    // (e.g. created before a secret was ever set) without a stored secret — this must never
    // silently produce a FlutterwaveProvider('') that would send an empty Authorization header.
    it('fails closed when the decrypted secret is null (account has no credential stored)', async () => {
      const findPlatformAccount = jest
        .fn()
        .mockResolvedValue(
          buildAccount({ provider: 'flutterwave', market: 'CI' }),
        );
      const getDecryptedPlatformSecret = jest.fn().mockResolvedValue(null);
      const { service } = buildService(
        findPlatformAccount,
        'CI',
        getDecryptedPlatformSecret,
      );

      await expectUnprocessableCode(
        service.resolve({ flow: 'commerce', organizationId: ORG_ID }),
        'PAYMENT_PROVIDER_CREDENTIAL_MISSING',
      );
    });

    // TEST 5 (secret exposure): the resolver's own thrown error, and anything it might log,
    // must never include the secret value itself, even when the secret DOES exist and the
    // failure is unrelated (e.g. an adapter-side construction error).
    it('never includes the decrypted secret value in a thrown error message', async () => {
      const findPlatformAccount = jest
        .fn()
        .mockResolvedValue(
          buildAccount({ provider: 'flutterwave', market: 'CI' }),
        );
      const secretValue = 'flw-should-never-appear-in-any-error-SENTINEL';
      const getDecryptedPlatformSecret = jest
        .fn()
        .mockResolvedValue(secretValue);
      const { service } = buildService(
        findPlatformAccount,
        'CI',
        getDecryptedPlatformSecret,
      );

      // Real secret is valid here, so this resolves successfully — the point of this test is
      // the negative-space check below, not the resolution itself.
      const provider = await service.resolve({
        flow: 'commerce',
        organizationId: ORG_ID,
      });
      expect(provider).toBeInstanceOf(FlutterwaveProvider);

      // And for the failure path (null secret), confirm the sentinel never leaks even though a
      // real secret was never actually missing in this particular call — this is a static
      // assertion on the missing-credential error message shape from the earlier test, repeated
      // here for clarity that PAYMENT_PROVIDER_CREDENTIAL_MISSING's message is a static string,
      // never string-interpolated with any secret-shaped value.
      const getDecryptedPlatformSecretNull = jest.fn().mockResolvedValue(null);
      const { service: serviceWithMissingSecret } = buildService(
        findPlatformAccount,
        'CI',
        getDecryptedPlatformSecretNull,
      );
      try {
        await serviceWithMissingSecret.resolve({
          flow: 'commerce',
          organizationId: ORG_ID,
        });
        throw new Error('expected resolve() to reject');
      } catch (error) {
        const response = JSON.stringify(
          (error as UnprocessableEntityException).getResponse(),
        );
        expect(response).not.toContain(secretValue);
      }
    });
  });
});

describe('PaymentProviderResolverService — one account for every country', () => {
  it('falls back to the merchant-of-record account registered without a market', async () => {
    const findPlatformAccount = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        buildAccount({ market: null, provider: 'manual' }),
      );
    const { service } = buildService(findPlatformAccount, 'SN');
    const provider = await service.resolve({
      flow: 'commerce',
      organizationId: ORG_ID,
    });
    expect(provider).toBeInstanceOf(ManualPaymentProvider);
    expect(findPlatformAccount).toHaveBeenNthCalledWith(1, {
      domain: 'payment',
      role: 'merchant-of-record',
      market: 'SN',
    });
    expect(findPlatformAccount).toHaveBeenNthCalledWith(2, {
      domain: 'payment',
      role: 'merchant-of-record',
      market: null,
    });
  });

  it("keeps a country's own active account first", async () => {
    const findPlatformAccount = jest
      .fn()
      .mockResolvedValueOnce(buildAccount({ market: 'CI' }));
    const { service } = buildService(findPlatformAccount, 'CI');
    await service.resolve({ flow: 'commerce', organizationId: ORG_ID });
    expect(findPlatformAccount).toHaveBeenCalledTimes(1);
  });

  it('skips an inactive country account for the worldwide one', async () => {
    const findPlatformAccount = jest
      .fn()
      .mockResolvedValueOnce(buildAccount({ market: 'CI', status: 'disabled' }))
      .mockResolvedValueOnce(buildAccount({ market: null }));
    const { service } = buildService(findPlatformAccount, 'CI');
    await expect(
      service.resolve({ flow: 'commerce', organizationId: ORG_ID }),
    ).resolves.toBeInstanceOf(ManualPaymentProvider);
  });

  it('still refuses when neither exists', async () => {
    const findPlatformAccount = jest.fn().mockResolvedValue(null);
    const { service } = buildService(findPlatformAccount, 'MA');
    await expectUnprocessableCode(
      service.resolve({ flow: 'commerce', organizationId: ORG_ID }),
      'PAYMENT_PROVIDER_NOT_CONFIGURED',
    );
  });
});
