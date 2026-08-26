import { randomUUID } from 'node:crypto';
import mongoose, { Connection, Model, Types } from 'mongoose';
import {
  Settlement,
  SettlementDocument,
  SettlementSchema,
} from './schemas/settlement.schema';
import { SettlementRepository } from './settlement.repository';

/**
 * Connects directly to the same docker-compose MongoDB used by this repo's e2e suite (see
 * apps/api/test/env.setup.ts), on a dedicated, collision-proof database so this unit spec never
 * touches dev/e2e data and can run concurrently with other test runs. No mongodb-memory-server
 * dependency exists in this repo — this mirrors the connection pattern env.setup.ts / the
 * mongo-isolation e2e spec already use, just scoped to this one file instead of the whole e2e
 * process.
 */
const TEST_DB_NAME = `korva_unit_settlement_${process.pid}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
const MONGODB_URI = `mongodb://korva:korva@localhost:27017/${TEST_DB_NAME}?authSource=admin&replicaSet=rs0`;

describe('SettlementRepository', () => {
  let connection: Connection;
  let repository: SettlementRepository;

  beforeAll(async () => {
    connection = await mongoose.createConnection(MONGODB_URI).asPromise();
    const model = connection.model(
      Settlement.name,
      SettlementSchema,
    ) as unknown as Model<SettlementDocument>;
    repository = new SettlementRepository(model);
  }, 30_000);

  afterAll(async () => {
    if (connection) {
      await connection.dropDatabase();
      await connection.close();
    }
  });

  afterEach(async () => {
    await connection.collection('settlements').deleteMany({});
  });

  function makeSettlementData(overrides: Partial<Settlement> = {}) {
    return {
      organizationId: new Types.ObjectId(),
      paymentId: new Types.ObjectId(),
      grossAmount: 10_000,
      currency: 'XOF',
      commissionRateBasisPoints: 1000,
      commissionAmount: 1_000,
      tenantAmount: 9_000,
      status: 'pending' as const,
      ...overrides,
    };
  }

  it('creates a settlement and persists the given fields', async () => {
    const organizationId = new Types.ObjectId();
    const created = await repository.create(
      makeSettlementData({ organizationId }),
    );

    expect(created._id).toBeDefined();
    expect(created.organizationId.toString()).toBe(organizationId.toString());
    expect(created.grossAmount).toBe(10_000);
    expect(created.commissionAmount).toBe(1_000);
    expect(created.tenantAmount).toBe(9_000);
    expect(created.status).toBe('pending');
  });

  it('finds a settlement by id scoped to its organization', async () => {
    const organizationId = new Types.ObjectId();
    const created = await repository.create(
      makeSettlementData({ organizationId }),
    );

    const found = await repository.findById(
      organizationId.toString(),
      created.id as string,
    );

    expect(found).not.toBeNull();
    expect(found?.id).toBe(created.id);
  });

  it('returns null when finding by id under the wrong organization', async () => {
    const created = await repository.create(makeSettlementData());
    const otherOrgId = new Types.ObjectId();

    const found = await repository.findById(
      otherOrgId.toString(),
      created.id as string,
    );

    expect(found).toBeNull();
  });

  it('returns null when finding by a malformed id', async () => {
    const found = await repository.findById(
      new Types.ObjectId().toString(),
      'not-a-valid-object-id',
    );
    expect(found).toBeNull();
  });

  describe('findAll — tenant-scoped listing', () => {
    it("never leaks another organization's settlements", async () => {
      const orgA = new Types.ObjectId();
      const orgB = new Types.ObjectId();

      await repository.create(
        makeSettlementData({ organizationId: orgA, grossAmount: 1_000 }),
      );
      await repository.create(
        makeSettlementData({ organizationId: orgA, grossAmount: 2_000 }),
      );
      await repository.create(
        makeSettlementData({ organizationId: orgB, grossAmount: 9_999 }),
      );

      const orgASettlements = await repository.findAll(orgA.toString());
      const orgBSettlements = await repository.findAll(orgB.toString());

      expect(orgASettlements).toHaveLength(2);
      expect(
        orgASettlements.every(
          (s) => s.organizationId.toString() === orgA.toString(),
        ),
      ).toBe(true);

      expect(orgBSettlements).toHaveLength(1);
      expect(orgBSettlements[0]!.organizationId.toString()).toBe(
        orgB.toString(),
      );
      expect(orgBSettlements[0]!.grossAmount).toBe(9_999);
    });

    it('returns an empty list for an organization with no settlements', async () => {
      const result = await repository.findAll(new Types.ObjectId().toString());
      expect(result).toEqual([]);
    });
  });

  describe('markSettled', () => {
    it('transitions status to settled and sets settledAt when the organization matches', async () => {
      const organizationId = new Types.ObjectId();
      const created = await repository.create(
        makeSettlementData({ organizationId }),
      );

      const updated = await repository.markSettled(
        organizationId.toString(),
        created.id as string,
        new Date(),
      );

      expect(updated).not.toBeNull();
      expect(updated?.status).toBe('settled');
      expect(updated?.settledAt).toBeInstanceOf(Date);
    });

    it('returns null (never updates) when the settlement belongs to a different organization', async () => {
      const created = await repository.create(makeSettlementData());
      const otherOrgId = new Types.ObjectId();

      const updated = await repository.markSettled(
        otherOrgId.toString(),
        created.id as string,
        new Date(),
      );

      expect(updated).toBeNull();

      const stillPending = await repository.findById(
        created.organizationId.toString(),
        created.id as string,
      );
      expect(stillPending?.status).toBe('pending');
    });
  });
});
