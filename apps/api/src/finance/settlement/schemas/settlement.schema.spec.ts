import mongoose, { Types } from 'mongoose';
import { SettlementSchema } from './settlement.schema';

// `mongoose.model()` compiles a usable Model without ever opening a DB connection —
// `.validateSync()` runs Mongoose's schema validation purely locally, so these tests never touch
// a real database (unlike settlement.repository.spec.ts, which does).
const SettlementModel = mongoose.model(
  'SettlementSchemaSpecModel',
  SettlementSchema,
);

function validSettlementData() {
  return {
    organizationId: new Types.ObjectId(),
    paymentId: new Types.ObjectId(),
    grossAmount: 10_000,
    currency: 'XOF',
    commissionRateBasisPoints: 1000,
    commissionAmount: 1_000,
    tenantAmount: 9_000,
  };
}

describe('Settlement schema', () => {
  it('validates a well-formed document with no errors', () => {
    const doc = new SettlementModel(validSettlementData());
    expect(doc.validateSync()).toBeUndefined();
  });

  it('defaults status to pending', () => {
    const doc = new SettlementModel(validSettlementData());
    expect(doc.status).toBe('pending');
  });

  it('rejects a status outside the enum', () => {
    const doc = new SettlementModel({
      ...validSettlementData(),
      status: 'bogus',
    });
    const error = doc.validateSync();
    expect(error?.errors.status).toBeDefined();
  });

  it.each([
    'organizationId',
    'paymentId',
    'grossAmount',
    'currency',
    'commissionRateBasisPoints',
    'commissionAmount',
    'tenantAmount',
  ])('requires %s', (field) => {
    const data = validSettlementData() as Record<string, unknown>;
    delete data[field];
    const doc = new SettlementModel(data);
    const error = doc.validateSync();
    expect(error?.errors[field]).toBeDefined();
  });

  it('indexes organizationId', () => {
    const indexes = SettlementSchema.indexes();
    const hasOrganizationIdIndex = indexes.some(([fields]) =>
      Object.prototype.hasOwnProperty.call(fields, 'organizationId'),
    );
    expect(hasOrganizationIdIndex).toBe(true);
  });

  it('carries a compound organizationId/status/createdAt index for tenant-scoped listing', () => {
    const indexes = SettlementSchema.indexes();
    const hasCompoundIndex = indexes.some(
      ([fields]) =>
        fields.organizationId === 1 &&
        fields.status === 1 &&
        fields.createdAt === -1,
    );
    expect(hasCompoundIndex).toBe(true);
  });
});

// Registered by `mongoose.model()` above onto the default global connection's model registry —
// deregister so re-running this file (e.g. --watch) doesn't hit "Cannot overwrite model" errors.
afterAll(() => {
  delete (mongoose.models as Record<string, unknown>).SettlementSchemaSpecModel;
});
