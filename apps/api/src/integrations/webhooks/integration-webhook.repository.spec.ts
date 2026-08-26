import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { IntegrationWebhookRepository } from './integration-webhook.repository';
import {
  IntegrationWebhookEvent,
  IntegrationWebhookEventSchema,
} from './schemas/integration-webhook-event.schema';

/**
 * Proves claimIfNew() is actually race-safe under real concurrent delivery, not just correct in
 * sequence — see integration-webhook-event.schema.spec.ts's own header comment for why this talks
 * to a real MongoDB (docker-compose's `mongodb` service) instead of a mock: a mocked model can't
 * exercise MongoDB's own duplicate-key arbitration, which is the entire mechanism under test.
 * Bootstraps a real (minimal) Nest module via MongooseModule — same DI wiring
 * IntegrationWebhookModule uses in production — rather than a bare mongoose connection, so the
 * injected model has exactly the type IntegrationWebhookRepository's constructor expects.
 */
const uri = `mongodb://korva:korva@localhost:27017/korva_test_iwe_repo_${process.pid}_${randomUUID().replace(/-/g, '').slice(0, 12)}?authSource=admin&replicaSet=rs0`;

describe('IntegrationWebhookRepository (real MongoDB, atomic insert-if-not-exists)', () => {
  let connection: Connection;
  let repository: IntegrationWebhookRepository;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(uri),
        MongooseModule.forFeature([
          {
            name: IntegrationWebhookEvent.name,
            schema: IntegrationWebhookEventSchema,
          },
        ]),
      ],
      providers: [IntegrationWebhookRepository],
    }).compile();

    repository = moduleRef.get(IntegrationWebhookRepository);
    connection = moduleRef.get(getConnectionToken());
    // Guarantees the unique index is actually built before any test runs — a bare `create()`
    // call could otherwise race the (async) index build the very first time this collection is
    // used, which would make TEST 3/4's race-safety proof meaningless.
    await connection.syncIndexes();
  }, 30_000);

  afterAll(async () => {
    if (connection) {
      await connection.dropDatabase();
      await connection.close();
    }
  }, 30_000);

  it('TEST 1 — the first claim for a new (provider, providerEventId) succeeds', async () => {
    const result = await repository.claimIfNew({
      provider: 'flutterwave',
      providerEventId: 'claim-sequential-1',
      domain: 'payment',
      payload: { amount: 100 },
    });

    expect(result.inserted).toBe(true);
    expect(result.event?.providerEventId).toBe('claim-sequential-1');
  });

  it('TEST 2 — a later claim for the SAME (provider, providerEventId) reports inserted: false, no throw', async () => {
    await repository.claimIfNew({
      provider: 'flutterwave',
      providerEventId: 'claim-sequential-2',
      domain: 'payment',
      payload: { amount: 200 },
    });

    const second = await repository.claimIfNew({
      provider: 'flutterwave',
      providerEventId: 'claim-sequential-2',
      domain: 'payment',
      payload: { amount: 200 },
    });

    expect(second.inserted).toBe(false);
    expect(second.event).toBeNull();
  });

  it('TEST 3 — race-safety proof: two concurrent claims for the identical (provider, providerEventId) — exactly one wins', async () => {
    const input = {
      provider: 'flutterwave',
      providerEventId: 'claim-concurrent-race',
      domain: 'payment' as const,
      payload: { amount: 300 },
    };

    const [first, second] = await Promise.all([
      repository.claimIfNew(input),
      repository.claimIfNew(input),
    ]);

    const insertedCount = [first, second].filter((r) => r.inserted).length;
    expect(insertedCount).toBe(1);

    // The actual persisted state — not just the two call results — must also show exactly one
    // document, proving no read-then-write window let both calls insert.
    const persistedCount = await connection
      .model(IntegrationWebhookEvent.name)
      .countDocuments({
        provider: 'flutterwave',
        providerEventId: 'claim-concurrent-race',
      });
    expect(persistedCount).toBe(1);
  });

  it('TEST 4 — higher-concurrency race-safety proof: 10 concurrent claims for the same event id — exactly one wins', async () => {
    const input = {
      provider: '360dialog',
      providerEventId: 'claim-concurrent-race-10',
      domain: 'messaging' as const,
      payload: { status: 'delivered' },
    };

    const results = await Promise.all(
      Array.from({ length: 10 }, () => repository.claimIfNew(input)),
    );

    expect(results.filter((r) => r.inserted).length).toBe(1);

    const persistedCount = await connection
      .model(IntegrationWebhookEvent.name)
      .countDocuments({
        provider: '360dialog',
        providerEventId: 'claim-concurrent-race-10',
      });
    expect(persistedCount).toBe(1);
  });
});
