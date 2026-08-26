import mongoose, { Types } from 'mongoose';
import {
  IntegrationAccount,
  IntegrationAccountSchema,
} from './integration-account.schema';

describe('IntegrationAccountSchema', () => {
  let Model: mongoose.Model<IntegrationAccount>;

  beforeAll(() => {
    // Unique model name per test run so re-running this file (e.g. --watch) never collides with
    // an already-registered mongoose model of the same name in the same process.
    Model = mongoose.model<IntegrationAccount>(
      `IntegrationAccountSchemaSpec_${Date.now()}_${Math.random()}`,
      IntegrationAccountSchema,
    );
  });

  it('marks secretEncrypted as select: false, mirroring ApiKey.keyHash / User.totpSecretEncrypted', () => {
    const path = IntegrationAccountSchema.path(
      'secretEncrypted',
    ) as unknown as {
      selected?: boolean;
    };
    expect(path.selected).toBe(false);
  });

  it('rejects an empty document — scope, domain, provider, role, status are required', () => {
    const doc = new Model({});
    const err = doc.validateSync();
    expect(err).toBeDefined();
    expect(err?.errors.scope).toBeDefined();
    expect(err?.errors.domain).toBeDefined();
    expect(err?.errors.provider).toBeDefined();
    expect(err?.errors.role).toBeDefined();
  });

  it('defaults status to pending, metadata to {}, and the optional date/nullable fields to null', () => {
    const doc = new Model({
      scope: 'tenant',
      organizationId: new Types.ObjectId(),
      domain: 'messaging',
      provider: '360dialog',
      role: '360dialog',
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.status).toBe('pending');
    expect(doc.metadata).toEqual({});
    expect(doc.market).toBeNull();
    expect(doc.secretEncrypted).toBeNull();
    expect(doc.lastVerifiedAt).toBeNull();
    expect(doc.lastErrorAt).toBeNull();
    expect(doc.lastErrorMessage).toBeNull();
  });

  it('validates a fully populated tenant-scope document', () => {
    const doc = new Model({
      scope: 'tenant',
      organizationId: new Types.ObjectId(),
      domain: 'messaging',
      provider: '360dialog',
      role: '360dialog',
      market: null,
      status: 'active',
      metadata: { wabaId: 'waba-1', phoneNumberId: 'phone-1' },
    });
    expect(doc.validateSync()).toBeUndefined();
  });

  it('validates a fully populated platform-scope document', () => {
    const doc = new Model({
      scope: 'platform',
      organizationId: null,
      domain: 'payment',
      provider: 'flutterwave',
      role: 'merchant-of-record',
      market: 'CI',
      status: 'active',
      secretEncrypted: 'iv:tag:ciphertext',
      metadata: { environment: 'sandbox' },
    });
    expect(doc.validateSync()).toBeUndefined();
  });

  it('rejects an out-of-range scope value', () => {
    const doc = new Model({
      scope: 'bogus',
      domain: 'payment',
      provider: 'flutterwave',
      role: 'merchant-of-record',
    });
    const err = doc.validateSync();
    expect(err?.errors.scope).toBeDefined();
  });

  it('rejects an out-of-range domain value', () => {
    const doc = new Model({
      scope: 'platform',
      domain: 'sms',
      provider: 'flutterwave',
      role: 'merchant-of-record',
    });
    const err = doc.validateSync();
    expect(err?.errors.domain).toBeDefined();
  });

  it('rejects an out-of-range status value', () => {
    const doc = new Model({
      scope: 'platform',
      domain: 'payment',
      provider: 'flutterwave',
      role: 'merchant-of-record',
      status: 'unknown-status',
    });
    const err = doc.validateSync();
    expect(err?.errors.status).toBeDefined();
  });

  it('declares the two documented unique partial indexes', () => {
    const indexes = IntegrationAccountSchema.indexes();
    const platformIndex = indexes.find(
      ([, options]) => options?.name === 'uniq_platform_account',
    );
    const tenantIndex = indexes.find(
      ([, options]) => options?.name === 'uniq_tenant_account',
    );

    expect(platformIndex).toBeDefined();
    expect(platformIndex?.[1]?.unique).toBe(true);
    expect(platformIndex?.[1]?.partialFilterExpression).toMatchObject({
      scope: 'platform',
    });

    expect(tenantIndex).toBeDefined();
    expect(tenantIndex?.[1]?.unique).toBe(true);
    expect(tenantIndex?.[1]?.partialFilterExpression).toMatchObject({
      scope: 'tenant',
    });
  });

  it('idToJson strips _id/__v in favor of id', () => {
    const doc = new Model({
      scope: 'tenant',
      organizationId: new Types.ObjectId(),
      domain: 'payment',
      provider: 'flutterwave',
      role: 'flutterwave',
    });

    const json = doc.toJSON() as Record<string, unknown>;
    expect(json.id).toBe(String(doc._id));
    expect(json._id).toBeUndefined();
    expect(json.__v).toBeUndefined();
  });
});
