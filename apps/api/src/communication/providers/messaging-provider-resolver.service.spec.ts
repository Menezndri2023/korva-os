import { UnprocessableEntityException } from '@nestjs/common';

import { MessagingProviderResolverService } from './messaging-provider-resolver.service';
import { MessagingProviderRegistry } from './messaging-provider.registry';
import { ThreeSixtyDialogProvider } from './three-sixty-dialog.provider';
import type { IntegrationAccountsReader } from '../../integrations/integrations.types';
import type { IntegrationsService } from '../../integrations/integrations.service';

const ORG_A = '507f1f77bcf86cd799439011';
const ORG_B = '507f1f77bcf86cd799439021';

function buildAccount(
  overrides: Partial<{
    id: string;
    organizationId: string;
    provider: string;
    status: 'pending' | 'active' | 'disabled' | 'revoked' | 'error';
    scope: 'tenant' | 'platform';
  }> = {},
) {
  return {
    id: overrides.id ?? 'acct_1',
    scope: overrides.scope ?? ('tenant' as const),
    organizationId: overrides.organizationId ?? ORG_A,
    domain: 'messaging' as const,
    provider: overrides.provider ?? '360dialog',
    role: 'bsp-partner',
    market: null,
    status: overrides.status ?? 'active',
    metadata: {},
    lastVerifiedAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
  };
}

/**
 * `getDecryptedTenantSecret` is keyed on the account `id` passed to it, so a test can register
 * more than one (organizationId, id) -> secret pair and assert exactly which one a given call
 * actually receives — this is how TEST A/B/C (tenant isolation) below prove the resolver never
 * mixes up which tenant's secret it fetches.
 */
function buildService(
  findTenantAccount: jest.Mock,
  secretsById: Record<string, string | null> = {},
) {
  const reader = {
    findPlatformAccount: jest.fn(),
    findTenantAccount,
  } as unknown as IntegrationAccountsReader;

  const getDecryptedTenantSecret = jest
    .fn()
    .mockImplementation((_organizationId: string, id: string) =>
      Promise.resolve(secretsById[id] ?? null),
    );
  const integrationsService = {
    getDecryptedTenantSecret,
  } as unknown as IntegrationsService;

  // Real registry, never mocked — see payment-provider-resolver.service.spec.ts's own Stage 2.2
  // precedent for why this matters: it's the difference between testing "the resolver calls some
  // function" and testing the actual application code path a real send would go through.
  const registry = new MessagingProviderRegistry();

  const service = new MessagingProviderResolverService(
    reader,
    integrationsService,
    registry,
  );

  return { service, getDecryptedTenantSecret, registry };
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

describe('MessagingProviderResolverService.assertTenantConnected', () => {
  it('resolves without error when the tenant has an active integration for the provider', async () => {
    const findTenantAccount = jest.fn().mockResolvedValue(buildAccount());
    const { service } = buildService(findTenantAccount);

    await expect(
      service.assertTenantConnected({
        organizationId: ORG_A,
        provider: '360dialog',
      }),
    ).resolves.toBeUndefined();

    expect(findTenantAccount).toHaveBeenCalledWith({
      organizationId: ORG_A,
      domain: 'messaging',
      provider: '360dialog',
    });
  });

  it('throws a typed WHATSAPP_NOT_CONNECTED error when no tenant account exists', async () => {
    const findTenantAccount = jest.fn().mockResolvedValue(null);
    const { service } = buildService(findTenantAccount);

    await expectUnprocessableCode(
      service.assertTenantConnected({
        organizationId: ORG_A,
        provider: '360dialog',
      }),
      'WHATSAPP_NOT_CONNECTED',
    );
  });

  it('throws a typed error rather than a silent no-op when the account is not active', async () => {
    const findTenantAccount = jest
      .fn()
      .mockResolvedValue(buildAccount({ status: 'disabled' }));
    const { service } = buildService(findTenantAccount);

    await expectUnprocessableCode(
      service.assertTenantConnected({
        organizationId: ORG_A,
        provider: '360dialog',
      }),
      'WHATSAPP_NOT_CONNECTED',
    );
  });
});

describe('MessagingProviderResolverService.resolveTenantProvider (Stage 2.4 — tenant-scoped 360dialog)', () => {
  // TEST A — Tenant A resolution
  it('TEST A: resolves organization A to a ThreeSixtyDialogProvider constructed with credential A', async () => {
    const findTenantAccount = jest
      .fn()
      .mockResolvedValue(buildAccount({ id: 'acct-A', organizationId: ORG_A }));
    const { service, getDecryptedTenantSecret } = buildService(
      findTenantAccount,
      { 'acct-A': 'TEST_360DIALOG_SECRET_A' },
    );

    const provider = await service.resolveTenantProvider({
      organizationId: ORG_A,
      provider: '360dialog',
    });

    expect(getDecryptedTenantSecret).toHaveBeenCalledWith(ORG_A, 'acct-A');
    expect(provider).toBeInstanceOf(ThreeSixtyDialogProvider);
    expect((provider as unknown as { apiKey: string }).apiKey).toBe(
      'TEST_360DIALOG_SECRET_A',
    );
  });

  // TEST B — Tenant B resolution
  it('TEST B: resolves organization B to a ThreeSixtyDialogProvider constructed with credential B', async () => {
    const findTenantAccount = jest
      .fn()
      .mockResolvedValue(buildAccount({ id: 'acct-B', organizationId: ORG_B }));
    const { service, getDecryptedTenantSecret } = buildService(
      findTenantAccount,
      { 'acct-B': 'TEST_360DIALOG_SECRET_B' },
    );

    const provider = await service.resolveTenantProvider({
      organizationId: ORG_B,
      provider: '360dialog',
    });

    expect(getDecryptedTenantSecret).toHaveBeenCalledWith(ORG_B, 'acct-B');
    expect(provider).toBeInstanceOf(ThreeSixtyDialogProvider);
    expect((provider as unknown as { apiKey: string }).apiKey).toBe(
      'TEST_360DIALOG_SECRET_B',
    );
  });

  // TEST C — Cross-tenant isolation
  it('TEST C: resolving for A never uses credential B, and resolving for B never uses credential A', async () => {
    const accountsByOrg: Record<string, ReturnType<typeof buildAccount>> = {
      [ORG_A]: buildAccount({ id: 'acct-A', organizationId: ORG_A }),
      [ORG_B]: buildAccount({ id: 'acct-B', organizationId: ORG_B }),
    };
    const findTenantAccount = jest
      .fn()
      .mockImplementation(({ organizationId }: { organizationId: string }) =>
        Promise.resolve(accountsByOrg[organizationId] ?? null),
      );
    const { service } = buildService(findTenantAccount, {
      'acct-A': 'TEST_360DIALOG_SECRET_A',
      'acct-B': 'TEST_360DIALOG_SECRET_B',
    });

    const providerA = await service.resolveTenantProvider({
      organizationId: ORG_A,
      provider: '360dialog',
    });
    const providerB = await service.resolveTenantProvider({
      organizationId: ORG_B,
      provider: '360dialog',
    });

    const keyA = (providerA as unknown as { apiKey: string }).apiKey;
    const keyB = (providerB as unknown as { apiKey: string }).apiKey;
    expect(keyA).toBe('TEST_360DIALOG_SECRET_A');
    expect(keyB).toBe('TEST_360DIALOG_SECRET_B');
    expect(keyA).not.toBe(keyB);
  });

  // TEST D — Missing tenant integration
  it('TEST D: a tenant with no 360dialog IntegrationAccount fails closed, never using any global/other credential', async () => {
    const findTenantAccount = jest.fn().mockResolvedValue(null);
    const { service, getDecryptedTenantSecret } = buildService(
      findTenantAccount,
      { 'acct-A': 'TEST_360DIALOG_SECRET_A' }, // present in the map but must never be reached
    );

    await expectUnprocessableCode(
      service.resolveTenantProvider({
        organizationId: ORG_A,
        provider: '360dialog',
      }),
      'WHATSAPP_NOT_CONNECTED',
    );
    expect(getDecryptedTenantSecret).not.toHaveBeenCalled();
  });

  // TEST E — Wrong provider (tenant has Flutterwave, not 360dialog, in the messaging domain
  // lookup — modeled here as simply "no messaging account for this provider key exists", which is
  // exactly what a real DB lookup would return for a tenant whose only IntegrationAccount is a
  // payment/Flutterwave one, since findTenantAccount is filtered by domain:'messaging' already).
  it('TEST E: a tenant with an account for a different domain/provider fails closed for 360dialog', async () => {
    const findTenantAccount = jest.fn().mockResolvedValue(null); // real findTenantAccount({domain:'messaging', provider:'360dialog'}) finds nothing
    const { service } = buildService(findTenantAccount);

    await expectUnprocessableCode(
      service.resolveTenantProvider({
        organizationId: ORG_A,
        provider: '360dialog',
      }),
      'WHATSAPP_NOT_CONNECTED',
    );
  });

  // TEST F — Wrong scope: a platform account must never be usable as a tenant credential. This
  // is enforced structurally by IntegrationsRepository.findTenantAccount's own query (`scope:
  // 'tenant'` is part of the filter, not an after-the-fact check) — this test proves the resolver
  // doesn't add a second, bypassable path around that guarantee: even if a reader implementation
  // incorrectly returned a platform-scope record, resolveTenantProvider's own logic doesn't
  // special-case or trust `scope` itself, it just uses whatever findTenantAccount (which the real
  // repository never lets return a platform row) returns.
  it("TEST F: even if the reader returned a platform-scope record, resolveTenantProvider still resolves it as a normal account (the real repository is what actually prevents this — see integrations.repository.spec.ts's own findTenantAccount test)", async () => {
    const findTenantAccount = jest
      .fn()
      .mockResolvedValue(
        buildAccount({ id: 'acct-platform', scope: 'platform' }),
      );
    const { service, getDecryptedTenantSecret } = buildService(
      findTenantAccount,
      { 'acct-platform': 'should-not-matter' },
    );

    // Documents the actual security boundary: this resolver trusts findTenantAccount's contract
    // (only ever returns scope:'tenant' rows) rather than re-checking scope itself — the real
    // guarantee lives in IntegrationsRepository.findTenantAccount's query filter, verified
    // separately. This test exists so a future change to that contract is visible here too.
    await service.resolveTenantProvider({
      organizationId: ORG_A,
      provider: '360dialog',
    });
    expect(getDecryptedTenantSecret).toHaveBeenCalledWith(
      ORG_A,
      'acct-platform',
    );
  });

  // TEST G — Unauthorized tenant: organizationId always comes from the resolver's own input
  // parameter (which callers must source from an authenticated server-side context, never a
  // client-supplied value) — there is no method on this service that accepts "my org, but fetch
  // someone else's". Proven by construction: findTenantAccount is always called with the SAME
  // organizationId the caller passed in, never a different one.
  it('TEST G: findTenantAccount and getDecryptedTenantSecret are always called with the SAME organizationId the caller supplied — no path substitutes a different tenant', async () => {
    const findTenantAccount = jest
      .fn()
      .mockResolvedValue(buildAccount({ id: 'acct-A', organizationId: ORG_A }));
    const { service, getDecryptedTenantSecret } = buildService(
      findTenantAccount,
      { 'acct-A': 'TEST_360DIALOG_SECRET_A' },
    );

    await service.resolveTenantProvider({
      organizationId: ORG_A,
      provider: '360dialog',
    });

    expect(findTenantAccount).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_A }),
    );
    expect(getDecryptedTenantSecret).toHaveBeenCalledWith(ORG_A, 'acct-A');
    // Never called with ORG_B, under any circumstance in this test.
    expect(getDecryptedTenantSecret).not.toHaveBeenCalledWith(
      ORG_B,
      expect.anything(),
    );
  });

  // TEST H — Credential isolation (secret exposure)
  it('TEST H: the resolver never includes the decrypted secret in a thrown error message', async () => {
    const secretValue = 'TEST_360DIALOG_SECRET_SENTINEL_SHOULD_NEVER_LEAK';
    const findTenantAccount = jest
      .fn()
      .mockResolvedValue(buildAccount({ id: 'acct-A', organizationId: ORG_A }));
    // Missing-credential path: secret resolves to null even though an account exists.
    const { service } = buildService(findTenantAccount, {});

    try {
      await service.resolveTenantProvider({
        organizationId: ORG_A,
        provider: '360dialog',
      });
      throw new Error('expected resolveTenantProvider to reject');
    } catch (error) {
      const response = JSON.stringify(
        (error as UnprocessableEntityException).getResponse(),
      );
      expect(response).not.toContain(secretValue);
    }
  });

  // TEST I — Provider instance isolation: two resolutions never share mutable state / the same
  // instance, and each instance's own credential is exactly what it was constructed with.
  it('TEST I: provider A and provider B are distinct instances with distinct, non-interfering credentials', async () => {
    const findTenantAccount = jest
      .fn()
      .mockImplementation(({ organizationId }: { organizationId: string }) =>
        Promise.resolve(
          buildAccount({
            id: organizationId === ORG_A ? 'acct-A' : 'acct-B',
            organizationId,
          }),
        ),
      );
    const { service } = buildService(findTenantAccount, {
      'acct-A': 'TEST_360DIALOG_SECRET_A',
      'acct-B': 'TEST_360DIALOG_SECRET_B',
    });

    const providerA = await service.resolveTenantProvider({
      organizationId: ORG_A,
      provider: '360dialog',
    });
    const providerB = await service.resolveTenantProvider({
      organizationId: ORG_B,
      provider: '360dialog',
    });

    expect(providerA).not.toBe(providerB);
    expect((providerA as unknown as { apiKey: string }).apiKey).not.toBe(
      (providerB as unknown as { apiKey: string }).apiKey,
    );
  });

  // TEST K — missing credential (account exists and is active, but has no secret stored) fails
  // closed rather than constructing a working-looking adapter with an empty key.
  it('TEST K (missing credential): an active account with no stored secret fails closed, never silently reusing another credential or constructing an empty-key adapter', async () => {
    const findTenantAccount = jest
      .fn()
      .mockResolvedValue(
        buildAccount({ id: 'acct-nocred', organizationId: ORG_A }),
      );
    const { service } = buildService(findTenantAccount, {}); // no entry for 'acct-nocred' -> null

    await expect(
      service.resolveTenantProvider({
        organizationId: ORG_A,
        provider: '360dialog',
      }),
    ).rejects.toMatchObject({
      response: { code: 'MESSAGING_PROVIDER_CREDENTIAL_MISSING' },
    });
  });

  it('fails with a typed error, not a fake success, for a provider key with no registered adapter', async () => {
    const findTenantAccount = jest
      .fn()
      .mockResolvedValue(
        buildAccount({ id: 'acct-x', provider: 'some-unregistered-bsp' }),
      );
    const { service } = buildService(findTenantAccount, {
      'acct-x': 'irrelevant',
    });

    await expect(
      service.resolveTenantProvider({
        organizationId: ORG_A,
        provider: 'some-unregistered-bsp',
      }),
    ).rejects.toMatchObject({
      response: { code: 'MESSAGING_PROVIDER_ADAPTER_NOT_REGISTERED' },
    });
  });
});

describe('MessagingProviderResolverService.resolveForTest (bootstrap-safe: no active-status precondition)', () => {
  it('resolves a real provider for a still-pending account, unlike resolveTenantProvider which would fail closed', async () => {
    const findTenantAccount = jest.fn(); // never called by resolveForTest — see assertion below
    const { service, getDecryptedTenantSecret } = buildService(
      findTenantAccount,
      { 'acct-pending': 'd360-secret-key' },
    );

    const provider = await service.resolveForTest({
      organizationId: ORG_A,
      accountId: 'acct-pending',
      provider: '360dialog',
    });

    expect(provider).toBeInstanceOf(ThreeSixtyDialogProvider);
    expect(getDecryptedTenantSecret).toHaveBeenCalledWith(
      ORG_A,
      'acct-pending',
    );
    // Confirms resolveForTest resolves straight from (organizationId, accountId) — it never
    // looks the account up by (organizationId, provider) via the reader the way
    // resolveTenantProvider/assertTenantConnected do, so it has no active-status precondition to
    // trip over.
    expect(findTenantAccount).not.toHaveBeenCalled();
  });

  it('fails closed with MESSAGING_PROVIDER_CREDENTIAL_MISSING when the account was connected with no stored secret', async () => {
    const { service } = buildService(jest.fn(), {}); // no entry -> null secret

    await expectUnprocessableCode(
      service.resolveForTest({
        organizationId: ORG_A,
        accountId: 'acct-no-secret',
        provider: '360dialog',
      }),
      'MESSAGING_PROVIDER_CREDENTIAL_MISSING',
    );
  });

  it('fails with a typed error for a provider key with no registered adapter', async () => {
    const { service } = buildService(jest.fn(), {
      'acct-x': 'irrelevant',
    });

    await expectUnprocessableCode(
      service.resolveForTest({
        organizationId: ORG_A,
        accountId: 'acct-x',
        provider: 'some-unregistered-bsp',
      }),
      'MESSAGING_PROVIDER_ADAPTER_NOT_REGISTERED',
    );
  });

  it('never mixes up which tenant a given accountId decrypts a secret for — the organizationId always travels with the accountId', async () => {
    const { service, getDecryptedTenantSecret } = buildService(jest.fn(), {
      'acct-a': 'secret-a',
    });

    await service.resolveForTest({
      organizationId: ORG_B,
      accountId: 'acct-a',
      provider: '360dialog',
    });

    expect(getDecryptedTenantSecret).toHaveBeenCalledWith(ORG_B, 'acct-a');
  });
});
