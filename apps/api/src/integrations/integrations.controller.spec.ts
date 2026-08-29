import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  connectMessagingAccountSchema,
  connectPaymentPayoutSchema,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import { IntegrationsController } from './integrations.controller';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { IntegrationsService } from './integrations.service';
import type { PaymentProviderResolverService } from '../finance/payments/providers/payment-provider-resolver.service';
import type { MessagingProviderResolverService } from '../communication/providers/messaging-provider-resolver.service';
import type { IntegrationAccountRecord } from './integrations.types';

const OWN_ORG_ID = 'org-own';
const OTHER_ORG_ID = 'org-other';
const MANAGE_PERMISSIONS = ['settings.manage'];

const TENANT = {
  organizationId: OWN_ORG_ID,
  permissions: MANAGE_PERMISSIONS,
} as unknown as TenantContext;

function makeRecord(
  overrides: Partial<IntegrationAccountRecord> = {},
): IntegrationAccountRecord {
  return {
    id: 'acct-1',
    scope: 'tenant',
    organizationId: OWN_ORG_ID,
    domain: 'payment',
    provider: 'flutterwave',
    role: 'flutterwave',
    market: 'CI',
    status: 'pending',
    metadata: {},
    lastVerifiedAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
    ...overrides,
  };
}

function buildController() {
  const listTenantAccounts = jest.fn();
  const getTenantAccount = jest.fn();
  const createTenantAccount = jest.fn();
  const revokeTenantAccount = jest.fn();
  const recordTenantAccountTestConnection = jest.fn();

  const integrationsService = {
    listTenantAccounts,
    getTenantAccount,
    createTenantAccount,
    revokeTenantAccount,
    recordTenantAccountTestConnection,
  } as unknown as IntegrationsService;

  const resolve = jest.fn();
  const paymentProviderResolver = {
    resolve,
  } as unknown as PaymentProviderResolverService;

  const assertTenantConnected = jest.fn().mockResolvedValue(undefined);
  const resolveTenantProvider = jest.fn();
  const resolveForTest = jest.fn();
  const messagingProviderResolver = {
    assertTenantConnected,
    resolveTenantProvider,
    resolveForTest,
  } as unknown as MessagingProviderResolverService;

  const controller = new IntegrationsController(
    integrationsService,
    paymentProviderResolver,
    messagingProviderResolver,
  );

  return {
    controller,
    listTenantAccounts,
    getTenantAccount,
    createTenantAccount,
    revokeTenantAccount,
    recordTenantAccountTestConnection,
    resolve,
    assertTenantConnected,
    resolveTenantProvider,
    resolveForTest,
  };
}

/** Mirrors health.controller.spec.ts's own catch-and-inspect pattern for asserting on a typed
 *  NestJS exception's `code`, without triggering `no-unsafe-assignment` on an `objectContaining`
 *  mixed into `.rejects.toMatchObject`. */
async function expectRejectedWithCode(
  promise: Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  let caught: UnprocessableEntityException | undefined;
  try {
    await promise;
  } catch (error) {
    caught = error as UnprocessableEntityException;
  }
  expect(caught).toBeInstanceOf(UnprocessableEntityException);
  const response = caught!.getResponse() as { code: string };
  expect(response.code).toBe(expectedCode);
}

/** Mirrors exactly what Nest's `@Body(new ZodValidationPipe(...))` does to the raw request body. */
function parsePaymentBody(raw: unknown): unknown {
  return new ZodValidationPipe(connectPaymentPayoutSchema).transform(raw);
}
function parseMessagingBody(raw: unknown): unknown {
  return new ZodValidationPipe(connectMessagingAccountSchema).transform(raw);
}

describe('connectPaymentPayoutSchema / connectMessagingAccountSchema (via ZodValidationPipe)', () => {
  it('accepts a valid payout payload', () => {
    expect(
      parsePaymentBody({
        payoutDetails: { bankCode: '001', accountNumber: '123' },
      }),
    ).toEqual({ payoutDetails: { bankCode: '001', accountNumber: '123' } });
  });

  it('rejects an empty payoutDetails object', () => {
    expect(() => parsePaymentBody({ payoutDetails: {} })).toThrow(
      BadRequestException,
    );
  });

  it('rejects a missing payoutDetails field', () => {
    expect(() => parsePaymentBody({})).toThrow(BadRequestException);
  });

  it('rejects a non-string payoutDetails value', () => {
    expect(() =>
      parsePaymentBody({ payoutDetails: { bankCode: 123 } }),
    ).toThrow(BadRequestException);
  });

  it('accepts a valid messaging connect payload', () => {
    expect(
      parseMessagingBody({
        wabaId: 'waba-1',
        phoneNumberId: 'phone-1',
        displayName: 'Acme Support',
        apiKey: 'd360-secret-key',
      }),
    ).toEqual({
      wabaId: 'waba-1',
      phoneNumberId: 'phone-1',
      displayName: 'Acme Support',
      apiKey: 'd360-secret-key',
    });
  });

  it('rejects a messaging connect payload with a blank field', () => {
    expect(() =>
      parseMessagingBody({
        wabaId: '',
        phoneNumberId: 'phone-1',
        displayName: 'x',
        apiKey: 'd360-secret-key',
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects a messaging connect payload missing a required field', () => {
    expect(() =>
      parseMessagingBody({ wabaId: 'waba-1', phoneNumberId: 'phone-1' }),
    ).toThrow(BadRequestException);
  });

  it('rejects a messaging connect payload with no apiKey — an account with no stored secret could never pass test-connection', () => {
    expect(() =>
      parseMessagingBody({
        wabaId: 'waba-1',
        phoneNumberId: 'phone-1',
        displayName: 'Acme Support',
      }),
    ).toThrow(BadRequestException);
  });
});

describe('IntegrationsController.list', () => {
  it('maps tenant accounts to the secret-free IntegrationSummary shape', async () => {
    const { controller, listTenantAccounts } = buildController();
    const verifiedAt = new Date('2026-01-01T00:00:00.000Z');
    listTenantAccounts.mockResolvedValue([
      makeRecord({ id: 'acct-1', lastVerifiedAt: verifiedAt }),
    ]);

    const result = await controller.list(TENANT);

    expect(listTenantAccounts).toHaveBeenCalledWith(
      OWN_ORG_ID,
      MANAGE_PERMISSIONS,
    );
    expect(result).toEqual([
      {
        id: 'acct-1',
        domain: 'payment',
        provider: 'flutterwave',
        status: 'pending',
        market: 'CI',
        lastVerifiedAt: verifiedAt.toISOString(),
        lastErrorAt: null,
        lastErrorMessage: null,
      },
    ]);
    // Never anything beyond IntegrationSummary's own fields.
    expect(result[0]).not.toHaveProperty('secretEncrypted');
    expect(result[0]).not.toHaveProperty('metadata');
    expect(result[0]).not.toHaveProperty('scope');
  });
});

describe('IntegrationsController.connectPayment', () => {
  it('registers a payout destination and persists a pending tenant account', async () => {
    const { controller, resolve, createTenantAccount } = buildController();
    const createPayoutDestination = jest
      .fn()
      .mockResolvedValue({ destinationRef: 'sub-123' });
    resolve.mockResolvedValue({
      name: 'flutterwave',
      createPayoutDestination,
    });
    createTenantAccount.mockResolvedValue(
      makeRecord({ id: 'acct-new', status: 'pending' }),
    );

    const body = parsePaymentBody({
      payoutDetails: { bankCode: '001', accountNumber: '123' },
    }) as { payoutDetails: Record<string, string> };

    const result = await controller.connectPayment(TENANT, body);

    expect(resolve).toHaveBeenCalledWith({
      flow: 'commerce',
      organizationId: OWN_ORG_ID,
    });
    expect(createPayoutDestination).toHaveBeenCalledWith({
      organizationId: OWN_ORG_ID,
      payoutDetails: body.payoutDetails,
    });
    expect(createTenantAccount).toHaveBeenCalledWith(
      OWN_ORG_ID,
      MANAGE_PERMISSIONS,
      expect.objectContaining({
        domain: 'payment',
        provider: 'flutterwave',
        metadata: { destinationRef: 'sub-123' },
      }),
    );
    expect(result.id).toBe('acct-new');
  });

  it('returns a typed error, not a fake success, when the resolved provider lacks createPayoutDestination', async () => {
    const { controller, resolve, createTenantAccount } = buildController();
    resolve.mockResolvedValue({ name: 'manual' });

    const body = parsePaymentBody({
      payoutDetails: { bankCode: '001' },
    }) as { payoutDetails: Record<string, string> };

    await expectRejectedWithCode(
      controller.connectPayment(TENANT, body),
      'PAYOUT_CONNECTION_NOT_SUPPORTED',
    );
    expect(createTenantAccount).not.toHaveBeenCalled();
  });

  // Stage 2.2 — TEST 3 (platform authorization): a normal tenant has no way to create a
  // platform-scope IntegrationAccount through this endpoint, structurally, not by a permission
  // check that could be misconfigured. Two independent proofs:
  it('strips a client-supplied "scope" field before it ever reaches the controller — connectPaymentPayoutSchema has no such field', () => {
    const raw = {
      payoutDetails: { bankCode: '001', accountNumber: '123' },
      scope: 'platform',
      organizationId: 'attacker-supplied-org-id',
    };

    const parsed = parsePaymentBody(raw) as Record<string, unknown>;

    expect(parsed).not.toHaveProperty('scope');
    expect(parsed).not.toHaveProperty('organizationId');
    expect(parsed).toEqual({ payoutDetails: raw.payoutDetails });
  });

  it('always calls createTenantAccount with the AUTHENTICATED tenant\'s own organizationId, never one from the request body, even if a "scope"/"organizationId" field is smuggled into the raw body', async () => {
    const { controller, resolve, createTenantAccount } = buildController();
    const createPayoutDestination = jest
      .fn()
      .mockResolvedValue({ destinationRef: 'sub-123' });
    resolve.mockResolvedValue({ name: 'flutterwave', createPayoutDestination });
    createTenantAccount.mockResolvedValue(makeRecord({ id: 'acct-new' }));

    const body = parsePaymentBody({
      payoutDetails: { bankCode: '001', accountNumber: '123' },
      scope: 'platform',
      organizationId: 'attacker-supplied-org-id',
    }) as { payoutDetails: Record<string, string> };

    await controller.connectPayment(TENANT, body);

    // resolve() and createTenantAccount() are both called with TENANT.organizationId
    // (OWN_ORG_ID, from the authenticated @CurrentTenant() context) — never the smuggled value,
    // and createTenantAccount has no parameter through which a caller could even pass a scope.
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: OWN_ORG_ID }),
    );
    expect(createTenantAccount).toHaveBeenCalledWith(
      OWN_ORG_ID,
      MANAGE_PERMISSIONS,
      expect.objectContaining({ domain: 'payment', provider: 'flutterwave' }),
    );
  });

  it('has no controller method anywhere that accepts or forwards a caller-supplied scope', () => {
    // IntegrationsController's own prototype — every route handler takes (tenant, body) or
    // (tenant, id[, body]); none accepts a raw "scope" parameter, and createPlatformAccount
    // (the only method that can produce a platform-scope row) is not called anywhere in this
    // controller — confirmed by static inspection of its source, not just this test's mocks.
    const controllerSource = IntegrationsController.toString();
    expect(controllerSource).not.toContain('createPlatformAccount');
  });
});

describe('IntegrationsController.connectMessaging', () => {
  it('persists the submitted WABA details as a pending 360dialog tenant account, no external call', async () => {
    const { controller, createTenantAccount, resolve } = buildController();
    createTenantAccount.mockResolvedValue(
      makeRecord({
        id: 'acct-msg',
        domain: 'messaging',
        provider: '360dialog',
        status: 'pending',
      }),
    );

    const body = parseMessagingBody({
      wabaId: 'waba-1',
      phoneNumberId: 'phone-1',
      displayName: 'Acme Support',
      apiKey: 'd360-secret-key',
    }) as {
      wabaId: string;
      phoneNumberId: string;
      displayName: string;
      apiKey: string;
    };

    const result = await controller.connectMessaging(TENANT, body);

    expect(resolve).not.toHaveBeenCalled();
    expect(createTenantAccount).toHaveBeenCalledWith(
      OWN_ORG_ID,
      MANAGE_PERMISSIONS,
      expect.objectContaining({
        domain: 'messaging',
        provider: '360dialog',
        secret: 'd360-secret-key',
        metadata: {
          wabaId: 'waba-1',
          phoneNumberId: 'phone-1',
          displayName: 'Acme Support',
        },
      }),
    );
    expect(result.provider).toBe('360dialog');
    expect(result.status).toBe('pending');
  });
});

describe('IntegrationsController.testConnection — payment domain', () => {
  it('calls testConnection and records a successful result', async () => {
    const {
      controller,
      getTenantAccount,
      resolve,
      recordTenantAccountTestConnection,
    } = buildController();
    getTenantAccount.mockResolvedValue(
      makeRecord({ id: 'acct-1', domain: 'payment' }),
    );
    const testConnection = jest
      .fn()
      .mockResolvedValue({ ok: true, message: 'looks good' });
    resolve.mockResolvedValue({ name: 'flutterwave', testConnection });

    const result = await controller.testConnection(TENANT, 'acct-1');

    expect(getTenantAccount).toHaveBeenCalledWith(
      OWN_ORG_ID,
      MANAGE_PERMISSIONS,
      'acct-1',
    );
    expect(testConnection).toHaveBeenCalled();
    expect(recordTenantAccountTestConnection).toHaveBeenCalledWith(
      OWN_ORG_ID,
      MANAGE_PERMISSIONS,
      'acct-1',
      { ok: true, message: 'looks good' },
    );
    expect(result).toEqual({ ok: true, message: 'looks good' });
  });

  it('returns a typed error, not a fake {ok:true}, when the resolved provider lacks testConnection', async () => {
    const {
      controller,
      getTenantAccount,
      resolve,
      recordTenantAccountTestConnection,
    } = buildController();
    getTenantAccount.mockResolvedValue(
      makeRecord({ id: 'acct-1', domain: 'payment' }),
    );
    resolve.mockResolvedValue({ name: 'manual' });

    await expectRejectedWithCode(
      controller.testConnection(TENANT, 'acct-1'),
      'TEST_CONNECTION_NOT_SUPPORTED',
    );
    expect(recordTenantAccountTestConnection).not.toHaveBeenCalled();
  });

  it("propagates a cross-org 404 rather than testing another org's account", async () => {
    const { controller, getTenantAccount, resolve } = buildController();
    getTenantAccount.mockRejectedValue(
      new NotFoundException({ code: 'INTEGRATION_ACCOUNT_NOT_FOUND' }),
    );

    await expect(
      controller.testConnection(TENANT, 'someone-elses-acct'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe('IntegrationsController.testConnection — messaging domain (Stage 2.4: gap closed; bootstrap deadlock fixed)', () => {
  it('resolves via resolveForTest (not resolveTenantProvider), calls testConnection, and records the result — a still-pending account can be tested', async () => {
    const {
      controller,
      getTenantAccount,
      resolveForTest,
      resolveTenantProvider,
      recordTenantAccountTestConnection,
    } = buildController();
    getTenantAccount.mockResolvedValue(
      makeRecord({
        id: 'acct-2',
        domain: 'messaging',
        provider: '360dialog',
        status: 'pending',
      }),
    );
    const testConnection = jest
      .fn()
      .mockResolvedValue({ ok: true, message: 'looks good' });
    resolveForTest.mockResolvedValue({
      name: '360dialog',
      testConnection,
    });

    const result = await controller.testConnection(TENANT, 'acct-2');

    expect(resolveForTest).toHaveBeenCalledWith({
      organizationId: OWN_ORG_ID,
      accountId: 'acct-2',
      provider: '360dialog',
    });
    // resolveTenantProvider is the active-only, real-send-path resolver — testConnection must
    // never use it, since a freshly connected (still-pending) account could then never pass its
    // first test (this is exactly the bootstrap deadlock this fix closes).
    expect(resolveTenantProvider).not.toHaveBeenCalled();
    expect(testConnection).toHaveBeenCalled();
    expect(recordTenantAccountTestConnection).toHaveBeenCalledWith(
      OWN_ORG_ID,
      MANAGE_PERMISSIONS,
      'acct-2',
      { ok: true, message: 'looks good' },
    );
    expect(result).toEqual({ ok: true, message: 'looks good' });
  });

  it('propagates MESSAGING_PROVIDER_CREDENTIAL_MISSING (not a fake success) when the account was connected with no stored secret', async () => {
    const { controller, getTenantAccount, resolveForTest } = buildController();
    getTenantAccount.mockResolvedValue(
      makeRecord({
        id: 'acct-2',
        domain: 'messaging',
        provider: '360dialog',
        status: 'pending',
      }),
    );
    const missingCredentialError = Object.assign(
      new Error('missing credential'),
      {
        response: { code: 'MESSAGING_PROVIDER_CREDENTIAL_MISSING' },
      },
    );
    resolveForTest.mockRejectedValue(missingCredentialError);

    await expect(controller.testConnection(TENANT, 'acct-2')).rejects.toBe(
      missingCredentialError,
    );
  });

  it('returns a typed error, not a fake {ok:true}, when the resolved provider lacks testConnection', async () => {
    const {
      controller,
      getTenantAccount,
      resolveForTest,
      recordTenantAccountTestConnection,
    } = buildController();
    getTenantAccount.mockResolvedValue(
      makeRecord({ id: 'acct-2', domain: 'messaging', provider: '360dialog' }),
    );
    resolveForTest.mockResolvedValue({ name: '360dialog' });

    await expectRejectedWithCode(
      controller.testConnection(TENANT, 'acct-2'),
      'TEST_CONNECTION_NOT_SUPPORTED',
    );
    expect(recordTenantAccountTestConnection).not.toHaveBeenCalled();
  });
});

describe('IntegrationsController.revoke', () => {
  it('revokes a tenant-scoped account and returns its summary', async () => {
    const { controller, revokeTenantAccount } = buildController();
    revokeTenantAccount.mockResolvedValue(
      makeRecord({ id: 'acct-1', status: 'revoked' }),
    );

    const result = await controller.revoke(TENANT, 'acct-1');

    expect(revokeTenantAccount).toHaveBeenCalledWith(
      OWN_ORG_ID,
      MANAGE_PERMISSIONS,
      'acct-1',
    );
    expect(result.status).toBe('revoked');
  });

  it("propagates a cross-org 404 rather than revoking another org's account", async () => {
    const { controller, revokeTenantAccount } = buildController();
    revokeTenantAccount.mockRejectedValue(
      new NotFoundException({ code: 'INTEGRATION_ACCOUNT_NOT_FOUND' }),
    );

    await expect(
      controller.revoke(
        {
          organizationId: OTHER_ORG_ID,
          permissions: MANAGE_PERMISSIONS,
        } as unknown as TenantContext,
        'someone-elses-acct',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
