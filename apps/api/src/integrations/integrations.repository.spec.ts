import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import {
  IntegrationsRepository,
  toIntegrationAccountRecord,
} from './integrations.repository';
import type { IntegrationAccountDocument } from './schemas/integration-account.schema';

/** Minimal chainable query stub — mirrors the subset of the Mongoose query builder API this
 *  repository actually calls (`.select()`, `.sort()`, `.exec()`), configurable per test via the
 *  `result` the terminal `.exec()` resolves to. */
function makeQuery<T>(result: T) {
  const exec = jest.fn().mockResolvedValue(result);
  const query = {
    select: jest.fn(),
    sort: jest.fn(),
    exec,
  };
  query.select.mockReturnValue(query);
  query.sort.mockReturnValue(query);
  return query;
}

function makeDoc(
  overrides: Partial<IntegrationAccountDocument> & {
    _id?: Types.ObjectId;
  } = {},
): IntegrationAccountDocument {
  return {
    _id: new Types.ObjectId(),
    scope: 'tenant',
    organizationId: new Types.ObjectId(),
    domain: 'payment',
    provider: 'flutterwave',
    role: '',
    market: null,
    status: 'active',
    secretEncrypted: 'iv:tag:ciphertext',
    metadata: { subaccountId: 'sub-123' },
    lastVerifiedAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
    ...overrides,
  } as unknown as IntegrationAccountDocument;
}

/** `model` is deliberately returned WITHOUT the `Model<IntegrationAccountDocument>` type
 *  annotation (only cast to it when handed to the repository's constructor) — keeping its
 *  inferred type a plain object of jest.fn()s, rather than the real Mongoose Model interface,
 *  avoids the `@typescript-eslint/unbound-method` false positive that fires when a bare method
 *  reference from a class/interface type is passed into `expect(...)`. */
function buildRepository() {
  const model = {
    create: jest.fn(),
    findById: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    updateOne: jest.fn(),
  };
  const repository = new IntegrationsRepository(
    model as unknown as Model<IntegrationAccountDocument>,
  );
  return { repository, model };
}

describe('toIntegrationAccountRecord', () => {
  it('never includes secretEncrypted, even when the source document carries one', () => {
    const doc = makeDoc({ secretEncrypted: 'iv:tag:ciphertext' });
    const record = toIntegrationAccountRecord(doc) as unknown as Record<
      string,
      unknown
    >;
    expect(record.secretEncrypted).toBeUndefined();
    expect(JSON.stringify(record)).not.toContain('ciphertext');
  });

  it('maps organizationId to a string, and null stays null (platform scope)', () => {
    const orgId = new Types.ObjectId();
    expect(
      toIntegrationAccountRecord(makeDoc({ organizationId: orgId }))
        .organizationId,
    ).toBe(String(orgId));
    expect(
      toIntegrationAccountRecord(makeDoc({ organizationId: null }))
        .organizationId,
    ).toBeNull();
  });
});

describe('IntegrationsRepository', () => {
  describe('create', () => {
    it('defaults status/secretEncrypted/metadata when not provided', async () => {
      const { repository, model } = buildRepository();
      const orgId = new Types.ObjectId();
      model.create.mockResolvedValue(makeDoc());

      await repository.create({
        scope: 'tenant',
        organizationId: orgId,
        domain: 'payment',
        provider: 'flutterwave',
        role: '',
        market: null,
      });

      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'pending',
          secretEncrypted: null,
          metadata: {},
        }),
      );
    });
  });

  describe('findByIdWithSecret', () => {
    it('re-selects +secretEncrypted', async () => {
      const { repository, model } = buildRepository();
      const doc = makeDoc();
      const query = makeQuery(doc);
      model.findById.mockReturnValue(query);

      const result = await repository.findByIdWithSecret(String(doc._id));

      expect(model.findById).toHaveBeenCalledWith(String(doc._id));
      expect(query.select).toHaveBeenCalledWith('+secretEncrypted');
      expect(result).toBe(doc);
    });

    it('returns null for an invalid id without querying the model', async () => {
      const { repository, model } = buildRepository();
      const result = await repository.findByIdWithSecret('not-an-object-id');
      expect(result).toBeNull();
      expect(model.findById).not.toHaveBeenCalled();
    });
  });

  describe('findByIdForOrganization', () => {
    it('filters by _id, scope: tenant, and organizationId together', async () => {
      const { repository, model } = buildRepository();
      const doc = makeDoc();
      const orgId = String(doc.organizationId);
      const query = makeQuery(doc);
      model.findOne.mockReturnValue(query);

      const result = await repository.findByIdForOrganization(
        String(doc._id),
        orgId,
      );

      expect(model.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: String(doc._id),
          scope: 'tenant',
          organizationId: new Types.ObjectId(orgId),
        }),
      );
      // never opts into secretEncrypted
      expect(query.select).not.toHaveBeenCalled();
      expect(result).toBe(doc);
    });

    it('returns null for a non-ObjectId id or organizationId without querying', async () => {
      const { repository, model } = buildRepository();
      expect(
        await repository.findByIdForOrganization('bad-id', 'bad-org'),
      ).toBeNull();
      expect(model.findOne).not.toHaveBeenCalled();
    });
  });

  describe('listByOrganization / listPlatformAccounts', () => {
    it('lists only tenant-scope docs for the given organization, sorted newest first', async () => {
      const { repository, model } = buildRepository();
      const orgId = new Types.ObjectId();
      const query = makeQuery([makeDoc({ organizationId: orgId })]);
      model.find.mockReturnValue(query);

      await repository.listByOrganization(String(orgId), 'payment');

      expect(model.find).toHaveBeenCalledWith({
        scope: 'tenant',
        organizationId: orgId,
        domain: 'payment',
      });
      expect(query.sort).toHaveBeenCalledWith({ createdAt: -1 });
    });

    it('lists only platform-scope docs', async () => {
      const { repository, model } = buildRepository();
      const query = makeQuery([makeDoc({ scope: 'platform' })]);
      model.find.mockReturnValue(query);

      await repository.listPlatformAccounts();

      expect(model.find).toHaveBeenCalledWith({ scope: 'platform' });
    });
  });

  describe('revoke / updateStatus', () => {
    it('revoke sets status to revoked, never deletes', async () => {
      const { repository, model } = buildRepository();
      const query = makeQuery(undefined);
      model.updateOne.mockReturnValue(query);

      await repository.revoke('id-1');

      expect(model.updateOne).toHaveBeenCalledWith(
        { _id: 'id-1' },
        { status: 'revoked', isLive: false },
      );
    });

    it('updateStatus merges status with any extra fields given', async () => {
      const { repository, model } = buildRepository();
      const query = makeQuery(undefined);
      model.updateOne.mockReturnValue(query);
      const now = new Date();

      await repository.updateStatus('id-1', 'active', {
        lastVerifiedAt: now,
      });

      expect(model.updateOne).toHaveBeenCalledWith(
        { _id: 'id-1' },
        { status: 'active', lastVerifiedAt: now },
      );
    });
  });

  describe('findPlatformAccount (IntegrationAccountsReader)', () => {
    it('queries by scope/domain/role/market and returns a secret-free record', async () => {
      const { repository, model } = buildRepository();
      const doc = makeDoc({
        scope: 'platform',
        organizationId: null,
        domain: 'payment',
        role: 'merchant-of-record',
        market: 'CI',
        secretEncrypted: 'iv:tag:super-secret-ciphertext',
      });
      const query = makeQuery(doc);
      model.findOne.mockReturnValue(query);

      const record = await repository.findPlatformAccount({
        domain: 'payment',
        role: 'merchant-of-record',
        market: 'CI',
      });

      expect(model.findOne).toHaveBeenCalledWith({
        scope: 'platform',
        domain: 'payment',
        role: 'merchant-of-record',
        market: 'CI',
        // Never a rotated-out (revoked) row.
        isLive: true,
      });
      expect(record).not.toBeNull();
      expect(record).not.toHaveProperty('secretEncrypted');
      expect(JSON.stringify(record)).not.toContain('super-secret-ciphertext');
    });

    it('returns null when no matching platform account exists', async () => {
      const { repository, model } = buildRepository();
      const query = makeQuery(null);
      model.findOne.mockReturnValue(query);

      const record = await repository.findPlatformAccount({
        domain: 'messaging',
        role: 'bsp-partner',
        market: null,
      });

      expect(record).toBeNull();
    });
  });

  describe('findTenantAccount (IntegrationAccountsReader)', () => {
    it('queries by scope/organizationId/domain/provider and returns a secret-free record', async () => {
      const { repository, model } = buildRepository();
      const orgId = new Types.ObjectId();
      const doc = makeDoc({
        scope: 'tenant',
        organizationId: orgId,
        domain: 'messaging',
        provider: '360dialog',
        secretEncrypted: 'iv:tag:tenant-secret-ciphertext',
      });
      const query = makeQuery(doc);
      model.findOne.mockReturnValue(query);

      const record = await repository.findTenantAccount({
        organizationId: String(orgId),
        domain: 'messaging',
        provider: '360dialog',
      });

      expect(model.findOne).toHaveBeenCalledWith({
        scope: 'tenant',
        organizationId: orgId,
        domain: 'messaging',
        provider: '360dialog',
        isLive: true,
      });
      expect(record).not.toBeNull();
      expect(record).not.toHaveProperty('secretEncrypted');
      expect(JSON.stringify(record)).not.toContain('tenant-secret-ciphertext');
    });

    it('returns null for an invalid organizationId without querying', async () => {
      const { repository, model } = buildRepository();

      const record = await repository.findTenantAccount({
        organizationId: 'not-an-object-id',
        domain: 'payment',
        provider: 'flutterwave',
      });

      expect(record).toBeNull();
      expect(model.findOne).not.toHaveBeenCalled();
    });

    it('returns null when no matching tenant account exists', async () => {
      const { repository, model } = buildRepository();
      const query = makeQuery(null);
      model.findOne.mockReturnValue(query);

      const record = await repository.findTenantAccount({
        organizationId: String(new Types.ObjectId()),
        domain: 'payment',
        provider: 'flutterwave',
      });

      expect(record).toBeNull();
    });
  });

  describe('findTenantAccountByWabaId (Stage 2.5 — 360dialog webhook tenant attribution)', () => {
    it('queries by scope/domain/provider/isLive/metadata.wabaId, never by organizationId (the caller does not have one yet)', async () => {
      const { repository, model } = buildRepository();
      const orgId = new Types.ObjectId();
      const doc = makeDoc({
        scope: 'tenant',
        organizationId: orgId,
        domain: 'messaging',
        provider: '360dialog',
        metadata: { wabaId: 'waba-A' },
        secretEncrypted: 'iv:tag:tenant-secret-ciphertext',
      });
      model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });

      const found = await repository.findTenantAccountByWabaId('waba-A');

      expect(model.findOne).toHaveBeenCalledWith({
        scope: 'tenant',
        domain: 'messaging',
        provider: '360dialog',
        isLive: true,
        'metadata.wabaId': 'waba-A',
      });
      expect(found).toBe(doc);
    });

    it('returns null when no live tenant account is connected with this WABA id', async () => {
      const { repository, model } = buildRepository();
      model.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      const found = await repository.findTenantAccountByWabaId('waba-unknown');

      expect(found).toBeNull();
    });
  });
});
