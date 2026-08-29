import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { IntegrationsService } from './integrations.service';
import type { IntegrationsRepository } from './integrations.repository';
import type { CredentialEncryptionService } from '../shared/crypto/credential-encryption.service';
import type { IntegrationAccountDocument } from './schemas/integration-account.schema';

const OWN_ORG_ID = String(new Types.ObjectId());
const OTHER_ORG_ID = String(new Types.ObjectId());
const MANAGE_PERMISSIONS = ['settings.manage'];
const READ_ONLY_PERMISSIONS = ['contacts.read'];

function makeDoc(
  overrides: Partial<IntegrationAccountDocument> = {},
): IntegrationAccountDocument {
  return {
    _id: new Types.ObjectId(),
    scope: 'tenant',
    organizationId: new Types.ObjectId(OWN_ORG_ID),
    domain: 'payment',
    provider: 'flutterwave',
    role: '',
    market: null,
    status: 'active',
    secretEncrypted: 'iv:tag:existing-ciphertext',
    metadata: { subaccountId: 'sub-1' },
    lastVerifiedAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
    ...overrides,
  } as unknown as IntegrationAccountDocument;
}

function buildService() {
  const create = jest.fn();
  const findByIdForOrganization = jest.fn();
  const findByIdWithSecret = jest.fn();
  const listByOrganization = jest.fn();
  const listPlatformAccounts = jest.fn();
  const revoke = jest.fn().mockResolvedValue(undefined);
  const updateStatus = jest.fn().mockResolvedValue(undefined);
  const findTenantAccountByWabaId = jest.fn();

  const integrationsRepository = {
    create,
    findByIdForOrganization,
    findByIdWithSecret,
    listByOrganization,
    listPlatformAccounts,
    revoke,
    updateStatus,
    findTenantAccountByWabaId,
  } as unknown as IntegrationsRepository;

  const encrypt = jest.fn((plaintext: string) => `enc(${plaintext})`);
  const decrypt = jest.fn((ciphertext: string) =>
    ciphertext.replace(/^enc\(|\)$/g, ''),
  );
  const credentialEncryptionService = {
    encrypt,
    decrypt,
  } as unknown as CredentialEncryptionService;

  const service = new IntegrationsService(
    integrationsRepository,
    credentialEncryptionService,
  );

  return {
    service,
    create,
    findByIdForOrganization,
    findByIdWithSecret,
    listByOrganization,
    listPlatformAccounts,
    revoke,
    updateStatus,
    findTenantAccountByWabaId,
    encrypt,
    decrypt,
  };
}

describe('IntegrationsService — authorization', () => {
  it('createTenantAccount rejects a caller without settings.manage', async () => {
    const { service, create } = buildService();

    await expect(
      service.createTenantAccount(OWN_ORG_ID, READ_ONLY_PERMISSIONS, {
        domain: 'payment',
        provider: 'flutterwave',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(create).not.toHaveBeenCalled();
  });

  it('listTenantAccounts rejects a caller without settings.manage', async () => {
    const { service, listByOrganization } = buildService();

    await expect(
      service.listTenantAccounts(OWN_ORG_ID, READ_ONLY_PERMISSIONS),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(listByOrganization).not.toHaveBeenCalled();
  });

  it('revokeTenantAccount rejects a caller without settings.manage', async () => {
    const { service, revoke } = buildService();

    await expect(
      service.revokeTenantAccount(OWN_ORG_ID, READ_ONLY_PERMISSIONS, 'id-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(revoke).not.toHaveBeenCalled();
  });

  it('rotateTenantAccountSecret rejects a caller without settings.manage', async () => {
    const { service, create } = buildService();

    await expect(
      service.rotateTenantAccountSecret(
        OWN_ORG_ID,
        READ_ONLY_PERMISSIONS,
        'id-1',
        'new-secret',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(create).not.toHaveBeenCalled();
  });

  it('a permission for a different resource ("payments.create") does not grant integration management', async () => {
    const { service } = buildService();

    await expect(
      service.createTenantAccount(OWN_ORG_ID, ['payments.create'], {
        domain: 'payment',
        provider: 'flutterwave',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('IntegrationsService — tenant isolation', () => {
  it("createTenantAccount always uses the actor's own organizationId — there is no way to pass a different one", async () => {
    const { service, create } = buildService();
    create.mockResolvedValue(makeDoc());

    await service.createTenantAccount(OWN_ORG_ID, MANAGE_PERMISSIONS, {
      domain: 'payment',
      provider: 'flutterwave',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: new Types.ObjectId(OWN_ORG_ID),
      }),
    );
  });

  it('getTenantAccount 404s (not 403s) when the account belongs to a different org — no existence leak', async () => {
    const { service, findByIdForOrganization } = buildService();
    // Repository correctly returns null: the row exists but not under OTHER_ORG_ID.
    findByIdForOrganization.mockResolvedValue(null);

    await expect(
      service.getTenantAccount(OTHER_ORG_ID, MANAGE_PERMISSIONS, 'id-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(findByIdForOrganization).toHaveBeenCalledWith('id-1', OTHER_ORG_ID);
  });

  it("rotateTenantAccountSecret cannot rotate another org's account", async () => {
    const { service, findByIdForOrganization, create } = buildService();
    findByIdForOrganization.mockResolvedValue(null);

    await expect(
      service.rotateTenantAccountSecret(
        OTHER_ORG_ID,
        MANAGE_PERMISSIONS,
        'id-1',
        'new-secret',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(create).not.toHaveBeenCalled();
  });

  it("revokeTenantAccount cannot revoke another org's account", async () => {
    const { service, findByIdForOrganization, revoke } = buildService();
    findByIdForOrganization.mockResolvedValue(null);

    await expect(
      service.revokeTenantAccount(OTHER_ORG_ID, MANAGE_PERMISSIONS, 'id-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(revoke).not.toHaveBeenCalled();
  });

  it("listTenantAccounts queries the repository scoped to the actor's own org only", async () => {
    const { service, listByOrganization } = buildService();
    listByOrganization.mockResolvedValue([]);

    await service.listTenantAccounts(
      OWN_ORG_ID,
      MANAGE_PERMISSIONS,
      'messaging',
    );

    expect(listByOrganization).toHaveBeenCalledWith(OWN_ORG_ID, 'messaging');
  });
});

describe('IntegrationsService — rotation and revocation', () => {
  it('rotateTenantAccountSecret inserts a new active row and revokes the old one — never deletes', async () => {
    const { service, findByIdForOrganization, create, revoke, encrypt } =
      buildService();
    const existing = makeDoc({ status: 'active' });
    const rotatedId = new Types.ObjectId();
    findByIdForOrganization.mockResolvedValue(existing);
    create.mockResolvedValue(makeDoc({ _id: rotatedId }));

    const result = await service.rotateTenantAccountSecret(
      OWN_ORG_ID,
      MANAGE_PERMISSIONS,
      String(existing._id),
      'brand-new-secret',
    );

    expect(encrypt).toHaveBeenCalledWith('brand-new-secret');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'tenant',
        status: 'active',
        secretEncrypted: 'enc(brand-new-secret)',
      }),
    );
    // The new row is a distinct document from the old one — the old id is revoked, not reused.
    expect(revoke).toHaveBeenCalledWith(String(existing._id));
    expect(result.id).toBe(String(rotatedId));
    expect(result.id).not.toBe(String(existing._id));
  });

  it('rotateTenantAccountSecret refuses to rotate an already-revoked account', async () => {
    const { service, findByIdForOrganization, create, revoke } = buildService();
    const existing = makeDoc({ status: 'revoked' });
    findByIdForOrganization.mockResolvedValue(existing);

    await expect(
      service.rotateTenantAccountSecret(
        OWN_ORG_ID,
        MANAGE_PERMISSIONS,
        String(existing._id),
        'new-secret',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(create).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });

  it('revokeTenantAccount marks status revoked via the repository, never calls a delete method', async () => {
    const { service, findByIdForOrganization, revoke } = buildService();
    const existing = makeDoc({ status: 'active' });
    findByIdForOrganization
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(makeDoc({ _id: existing._id, status: 'revoked' }));

    const result = await service.revokeTenantAccount(
      OWN_ORG_ID,
      MANAGE_PERMISSIONS,
      String(existing._id),
    );

    expect(revoke).toHaveBeenCalledWith(String(existing._id));
    expect(result.status).toBe('revoked');
    // The repository/model exposes no delete/remove method on this mock at all — nothing in
    // IntegrationsService could have called one.
    expect(
      (integrationsRepositoryOf(service) as Record<string, unknown>).delete,
    ).toBeUndefined();
  });
});

describe('IntegrationsService — recordTenantAccountTestConnection (Wave 4 Stage 2)', () => {
  it('rejects a caller without settings.manage', async () => {
    const { service, updateStatus } = buildService();

    await expect(
      service.recordTenantAccountTestConnection(
        OWN_ORG_ID,
        READ_ONLY_PERMISSIONS,
        'id-1',
        { ok: true },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it("cannot record a test-connection result for another org's account", async () => {
    const { service, findByIdForOrganization, updateStatus } = buildService();
    findByIdForOrganization.mockResolvedValue(null);

    await expect(
      service.recordTenantAccountTestConnection(
        OTHER_ORG_ID,
        MANAGE_PERMISSIONS,
        'id-1',
        { ok: true },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it('refuses to record a result for an already-revoked account', async () => {
    const { service, findByIdForOrganization, updateStatus } = buildService();
    const existing = makeDoc({ status: 'revoked' });
    findByIdForOrganization.mockResolvedValue(existing);

    await expect(
      service.recordTenantAccountTestConnection(
        OWN_ORG_ID,
        MANAGE_PERMISSIONS,
        String(existing._id),
        { ok: true },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it('a successful result promotes status to active and clears any prior error', async () => {
    const { service, findByIdForOrganization, updateStatus } = buildService();
    const existing = makeDoc({ status: 'pending' });
    findByIdForOrganization
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(makeDoc({ _id: existing._id, status: 'active' }));

    const result = await service.recordTenantAccountTestConnection(
      OWN_ORG_ID,
      MANAGE_PERMISSIONS,
      String(existing._id),
      { ok: true },
    );

    expect(updateStatus).toHaveBeenCalledTimes(1);
    const [calledId, calledStatus, calledExtra] = updateStatus.mock
      .calls[0] as [
      string,
      string,
      { lastVerifiedAt: Date; lastErrorAt: null; lastErrorMessage: null },
    ];
    expect(calledId).toBe(String(existing._id));
    expect(calledStatus).toBe('active');
    expect(calledExtra.lastVerifiedAt).toBeInstanceOf(Date);
    expect(calledExtra.lastErrorAt).toBeNull();
    expect(calledExtra.lastErrorMessage).toBeNull();
    expect(result.status).toBe('active');
  });

  it('a failed result leaves status unchanged and records the error message', async () => {
    const { service, findByIdForOrganization, updateStatus } = buildService();
    const existing = makeDoc({ status: 'active' });
    findByIdForOrganization
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(existing);

    await service.recordTenantAccountTestConnection(
      OWN_ORG_ID,
      MANAGE_PERMISSIONS,
      String(existing._id),
      { ok: false, message: 'invalid credentials' },
    );

    expect(updateStatus).toHaveBeenCalledTimes(1);
    const [calledId, calledStatus, calledExtra] = updateStatus.mock
      .calls[0] as [
      string,
      string,
      { lastErrorAt: Date; lastErrorMessage: string },
    ];
    expect(calledId).toBe(String(existing._id));
    expect(calledStatus).toBe('active');
    expect(calledExtra.lastErrorAt).toBeInstanceOf(Date);
    expect(calledExtra.lastErrorMessage).toBe('invalid credentials');
  });

  it('a failed result with no message falls back to a generic message', async () => {
    const { service, findByIdForOrganization, updateStatus } = buildService();
    const existing = makeDoc({ status: 'active' });
    findByIdForOrganization
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(existing);

    await service.recordTenantAccountTestConnection(
      OWN_ORG_ID,
      MANAGE_PERMISSIONS,
      String(existing._id),
      { ok: false },
    );

    expect(updateStatus).toHaveBeenCalledWith(
      String(existing._id),
      'active',
      expect.objectContaining({
        lastErrorMessage: 'Test connection failed',
      }),
    );
  });
});

describe('IntegrationsService — secrets never leak into a returned DTO', () => {
  it('createTenantAccount never returns secretEncrypted or the plaintext secret', async () => {
    const { service, create } = buildService();
    create.mockResolvedValue(
      makeDoc({ secretEncrypted: 'enc(super-secret-plaintext)' }),
    );

    const result = await service.createTenantAccount(
      OWN_ORG_ID,
      MANAGE_PERMISSIONS,
      {
        domain: 'payment',
        provider: 'flutterwave',
        secret: 'super-secret-plaintext',
      },
    );

    expect(result).not.toHaveProperty('secretEncrypted');
    expect(JSON.stringify(result)).not.toContain('super-secret-plaintext');
  });

  it('rotateTenantAccountSecret never returns secretEncrypted or the new plaintext secret', async () => {
    const { service, findByIdForOrganization, create } = buildService();
    const existing = makeDoc({ status: 'active' });
    findByIdForOrganization.mockResolvedValue(existing);
    create.mockResolvedValue(
      makeDoc({
        _id: new Types.ObjectId(),
        secretEncrypted: 'enc(brand-new-secret-plaintext)',
      }),
    );

    const result = await service.rotateTenantAccountSecret(
      OWN_ORG_ID,
      MANAGE_PERMISSIONS,
      String(existing._id),
      'brand-new-secret-plaintext',
    );

    expect(result).not.toHaveProperty('secretEncrypted');
    expect(JSON.stringify(result)).not.toContain('brand-new-secret-plaintext');
  });

  it('listTenantAccounts never returns secretEncrypted for any row', async () => {
    const { service, listByOrganization } = buildService();
    listByOrganization.mockResolvedValue([
      makeDoc({ secretEncrypted: 'enc(secret-one)' }),
      makeDoc({ secretEncrypted: 'enc(secret-two)' }),
    ]);

    const results = await service.listTenantAccounts(
      OWN_ORG_ID,
      MANAGE_PERMISSIONS,
    );

    for (const record of results) {
      expect(record).not.toHaveProperty('secretEncrypted');
    }
    expect(JSON.stringify(results)).not.toMatch(/secret-(one|two)/);
  });
});

describe('IntegrationsService — platform scope is structurally unreachable from tenant methods', () => {
  it('createPlatformAccount takes no organizationId/actor parameter', () => {
    // Arity proof: the tenant-facing signature requires (orgId, permissions, input) — the
    // platform-facing one only ever takes (input). There is no overload or parameter through
    // which a tenant's organizationId could reach a platform-scope write.
    expect(IntegrationsService.prototype.createPlatformAccount.length).toBe(1);
    expect(IntegrationsService.prototype.createTenantAccount.length).toBe(3);
  });

  it('createPlatformAccount stores organizationId: null unconditionally', async () => {
    const { service, create } = buildService();
    create.mockResolvedValue(
      makeDoc({ scope: 'platform', organizationId: null }),
    );

    await service.createPlatformAccount({
      domain: 'payment',
      provider: 'flutterwave',
      role: 'merchant-of-record',
      market: 'CI',
      secret: 'korva-own-secret',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'platform', organizationId: null }),
    );
  });

  it('getDecryptedPlatformSecret refuses to decrypt a tenant-scope row even by id', async () => {
    const { service, findByIdWithSecret, decrypt } = buildService();
    findByIdWithSecret.mockResolvedValue(makeDoc({ scope: 'tenant' }));

    const secret = await service.getDecryptedPlatformSecret('id-1');

    expect(secret).toBeNull();
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('getDecryptedPlatformSecret returns the decrypted secret for a genuine platform row', async () => {
    const { service, findByIdWithSecret } = buildService();
    findByIdWithSecret.mockResolvedValue(
      makeDoc({ scope: 'platform', secretEncrypted: 'enc(korva-secret)' }),
    );

    const secret = await service.getDecryptedPlatformSecret('id-1');

    expect(secret).toBe('korva-secret');
  });

  it('getDecryptedPlatformSecret returns null when the account holds no secret', async () => {
    const { service, findByIdWithSecret, decrypt } = buildService();
    findByIdWithSecret.mockResolvedValue(
      makeDoc({ scope: 'platform', secretEncrypted: null }),
    );

    const secret = await service.getDecryptedPlatformSecret('id-1');

    expect(secret).toBeNull();
    expect(decrypt).not.toHaveBeenCalled();
  });
});

describe('IntegrationsService — findTenantOrganizationIdByWabaId (Stage 2.5 — 360dialog webhook tenant attribution)', () => {
  it("returns the connected account's own organizationId — never anything from a caller-supplied value, since this method takes none", async () => {
    const { service, findTenantAccountByWabaId } = buildService();
    const orgId = new Types.ObjectId(OWN_ORG_ID);
    findTenantAccountByWabaId.mockResolvedValue(
      makeDoc({
        domain: 'messaging',
        provider: '360dialog',
        organizationId: orgId,
      }),
    );

    const resolved = await service.findTenantOrganizationIdByWabaId('waba-A');

    expect(findTenantAccountByWabaId).toHaveBeenCalledWith('waba-A');
    expect(resolved).toBe(String(orgId));
  });

  it('returns null (fails closed) when no live tenant account is connected with this WABA id — never guesses a default tenant', async () => {
    const { service, findTenantAccountByWabaId } = buildService();
    findTenantAccountByWabaId.mockResolvedValue(null);

    const resolved =
      await service.findTenantOrganizationIdByWabaId('waba-unknown');

    expect(resolved).toBeNull();
  });
});

/** Reaches into the service's private repository field only to assert the mock shape carries no
 *  delete/remove method — see the "never deletes" test above. */
function integrationsRepositoryOf(service: IntegrationsService): unknown {
  return (service as unknown as { integrationsRepository: unknown })
    .integrationsRepository;
}
