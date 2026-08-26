import { UnprocessableEntityException } from '@nestjs/common';

import { MessagingProviderResolverService } from './messaging-provider-resolver.service';
import type { IntegrationAccountsReader } from '../../integrations/integrations.types';

const ORG_ID = '507f1f77bcf86cd799439011';

function buildAccount(
  overrides: Partial<{
    status: 'pending' | 'active' | 'disabled' | 'revoked' | 'error';
  }> = {},
) {
  return {
    id: 'acct_1',
    scope: 'tenant' as const,
    organizationId: ORG_ID,
    domain: 'messaging' as const,
    provider: '360dialog',
    role: 'bsp-partner',
    market: null,
    status: overrides.status ?? 'active',
    metadata: {},
    lastVerifiedAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
  };
}

function buildService(findTenantAccount: jest.Mock) {
  const reader = {
    findPlatformAccount: jest.fn(),
    findTenantAccount,
  } as unknown as IntegrationAccountsReader;

  return new MessagingProviderResolverService(reader);
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

describe('MessagingProviderResolverService', () => {
  it('resolves without error when the tenant has an active integration for the provider', async () => {
    const findTenantAccount = jest.fn().mockResolvedValue(buildAccount());
    const service = buildService(findTenantAccount);

    await expect(
      service.assertTenantConnected({
        organizationId: ORG_ID,
        provider: '360dialog',
      }),
    ).resolves.toBeUndefined();

    expect(findTenantAccount).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      domain: 'messaging',
      provider: '360dialog',
    });
  });

  it('throws a typed WHATSAPP_NOT_CONNECTED error when no tenant account exists', async () => {
    const findTenantAccount = jest.fn().mockResolvedValue(null);
    const service = buildService(findTenantAccount);

    await expectUnprocessableCode(
      service.assertTenantConnected({
        organizationId: ORG_ID,
        provider: '360dialog',
      }),
      'WHATSAPP_NOT_CONNECTED',
    );
  });

  it('throws a typed error rather than a silent no-op when the account is not active', async () => {
    const findTenantAccount = jest
      .fn()
      .mockResolvedValue(buildAccount({ status: 'disabled' }));
    const service = buildService(findTenantAccount);

    await expectUnprocessableCode(
      service.assertTenantConnected({
        organizationId: ORG_ID,
        provider: '360dialog',
      }),
      'WHATSAPP_NOT_CONNECTED',
    );
  });
});
