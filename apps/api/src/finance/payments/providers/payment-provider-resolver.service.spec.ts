import { UnprocessableEntityException } from '@nestjs/common';

import { PaymentProviderResolverService } from './payment-provider-resolver.service';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { ManualPaymentProvider } from './manual-payment.provider';
import type { OrganizationsService } from '../../../organizations/organizations.service';
import type { IntegrationAccountsReader } from '../../../integrations/integrations.types';

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

  const service = new PaymentProviderResolverService(
    reader,
    organizationsService,
    registry,
  );

  return { service, getById, registry };
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
});
