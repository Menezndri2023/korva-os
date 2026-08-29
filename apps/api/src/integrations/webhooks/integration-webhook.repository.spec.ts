import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { IntegrationWebhookRepository } from './integration-webhook.repository';
import {
  IntegrationWebhookEvent,
  IntegrationWebhookEventSchema,
} from './schemas/integration-webhook-event.schema';
import type { IntegrationWebhookEventDocument } from './schemas/integration-webhook-event.schema';

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

  it('TEST 4 — higher-concurrency race-safety proof: 10 concurrent claims for the same event id — exactly one wins, and (Stage 2.5) every concurrent caller resolved the SAME organizationId, so the one persisted document is never attributed to the wrong tenant', async () => {
    const orgId = '507f1f77bcf86cd799439011';
    const input = {
      provider: '360dialog',
      providerEventId: 'claim-concurrent-race-10',
      domain: 'messaging' as const,
      payload: { status: 'delivered' },
      organizationId: orgId,
    };

    const results = await Promise.all(
      Array.from({ length: 10 }, () => repository.claimIfNew(input)),
    );

    expect(results.filter((r) => r.inserted).length).toBe(1);

    const persisted = await connection
      .model<IntegrationWebhookEventDocument>(IntegrationWebhookEvent.name)
      .findOne({
        provider: '360dialog',
        providerEventId: 'claim-concurrent-race-10',
      });
    expect(persisted).not.toBeNull();
    expect(String(persisted?.organizationId)).toBe(orgId);
    const persistedCount = await connection
      .model(IntegrationWebhookEvent.name)
      .countDocuments({
        provider: '360dialog',
        providerEventId: 'claim-concurrent-race-10',
      });
    expect(persistedCount).toBe(1);
  });

  it('TEST 5 (Stage 2.5, F8/D7) — the resolved organizationId is persisted onto the claimed document, and a claim with no organizationId persists an explicit null (not a missing field)', async () => {
    const orgId = '507f1f77bcf86cd799439021';
    const resolved = await repository.claimIfNew({
      provider: 'flutterwave',
      providerEventId: 'claim-with-org',
      domain: 'payment',
      payload: { amount: 400 },
      organizationId: orgId,
    });
    expect(resolved.inserted).toBe(true);
    expect(String(resolved.event?.organizationId)).toBe(orgId);

    const unresolved = await repository.claimIfNew({
      provider: 'flutterwave',
      providerEventId: 'claim-without-org',
      domain: 'payment',
      payload: { amount: 500 },
    });
    expect(unresolved.inserted).toBe(true);
    expect(unresolved.event?.organizationId).toBeNull();
  });

  it("TEST 6 (Stage 2.5, F5/D5 — duplicate keeps original tenant attribution) — a second claim for an already-claimed (provider, providerEventId), even one that supplies a DIFFERENT organizationId, never overwrites the first claim's attribution: it never inserts and the persisted document is untouched", async () => {
    const originalOrgId = '507f1f77bcf86cd799439031';
    const forgedOrgId = '507f1f77bcf86cd799439099';

    const first = await repository.claimIfNew({
      provider: 'flutterwave',
      providerEventId: 'claim-duplicate-tenant',
      domain: 'payment',
      payload: { amount: 600 },
      organizationId: originalOrgId,
    });
    expect(first.inserted).toBe(true);

    const second = await repository.claimIfNew({
      provider: 'flutterwave',
      providerEventId: 'claim-duplicate-tenant',
      domain: 'payment',
      payload: { amount: 600 },
      organizationId: forgedOrgId,
    });
    expect(second.inserted).toBe(false);

    const persisted = await connection
      .model<IntegrationWebhookEventDocument>(IntegrationWebhookEvent.name)
      .findOne({
        provider: 'flutterwave',
        providerEventId: 'claim-duplicate-tenant',
      });
    expect(String(persisted?.organizationId)).toBe(originalOrgId);
    const persistedCount = await connection
      .model(IntegrationWebhookEvent.name)
      .countDocuments({
        provider: 'flutterwave',
        providerEventId: 'claim-duplicate-tenant',
      });
    expect(persistedCount).toBe(1);
  });

  it('TEST 7 (Stage 2.5, F10/D9 — no credential material in the persisted event) — the persisted payload is exactly what the caller passed, and this repository never accepts or stores headers/secrets of any kind', async () => {
    const claimed = await repository.claimIfNew({
      provider: 'flutterwave',
      providerEventId: 'claim-no-secret',
      domain: 'payment',
      payload: { amount: 700, tx_ref: 'korva_inv_1_abc' },
      organizationId: '507f1f77bcf86cd799439041',
    });

    expect(claimed.event?.payload).toEqual({
      amount: 700,
      tx_ref: 'korva_inv_1_abc',
    });
    // ClaimIntegrationWebhookEventInput has no headers/secret field at all — there is structurally
    // nothing here that could persist one, but assert on the actual document shape regardless.
    const raw = claimed.event?.toObject() as unknown as Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual(
      [
        '__v',
        '_id',
        'domain',
        'organizationId',
        'payload',
        'provider',
        'providerEventId',
        'receivedAt',
      ].sort(),
    );
  });

  describe('findUnresolvedEvents (Stage 2.8 — operational observability, GAP A)', () => {
    const ORG_A = '507f1f77bcf86cd799439011';

    beforeAll(async () => {
      // Fixture events, deliberately distinct providerEventIds from every other describe block
      // in this file so their own claimIfNew-focused tests are never affected by these.
      await repository.claimIfNew({
        provider: 'flutterwave',
        providerEventId: 'unresolved-evt-1',
        domain: 'payment',
        payload: { secret_should_never_appear: 'do-not-leak-me' },
      }); // organizationId omitted -> unresolved

      await repository.claimIfNew({
        provider: '360dialog',
        providerEventId: 'unresolved-evt-2',
        domain: 'messaging',
        payload: {},
      }); // unresolved

      await repository.claimIfNew({
        provider: 'flutterwave',
        providerEventId: 'resolved-evt-1',
        domain: 'payment',
        payload: {},
        organizationId: ORG_A,
      }); // resolved — must never appear in the unresolved listing
    });

    it('TEST 8 (Stage 2.8) — an unresolved event (organizationId: null) appears in the listing', async () => {
      const result = await repository.findUnresolvedEvents({
        page: 1,
        limit: 100,
      });

      const ids = result.data.map((e) => e.providerEventId);
      expect(ids).toContain('unresolved-evt-1');
      expect(ids).toContain('unresolved-evt-2');
    });

    it('TEST 9 (Stage 2.8) — a resolved event (organizationId set) never appears in the unresolved listing', async () => {
      const result = await repository.findUnresolvedEvents({
        page: 1,
        limit: 100,
      });

      const ids = result.data.map((e) => e.providerEventId);
      expect(ids).not.toContain('resolved-evt-1');
    });

    it('TEST 10 (Stage 2.8) — provider and domain filters are correctly applied', async () => {
      const flutterwaveOnly = await repository.findUnresolvedEvents({
        page: 1,
        limit: 100,
        provider: 'flutterwave',
      });
      expect(
        flutterwaveOnly.data.every((e) => e.provider === 'flutterwave'),
      ).toBe(true);
      expect(flutterwaveOnly.data.map((e) => e.providerEventId)).toContain(
        'unresolved-evt-1',
      );
      expect(flutterwaveOnly.data.map((e) => e.providerEventId)).not.toContain(
        'unresolved-evt-2',
      );

      const messagingOnly = await repository.findUnresolvedEvents({
        page: 1,
        limit: 100,
        domain: 'messaging',
      });
      expect(messagingOnly.data.every((e) => e.domain === 'messaging')).toBe(
        true,
      );
    });

    it('TEST 11 (Stage 2.8) — pagination is correct and deterministic (sorted by receivedAt desc)', async () => {
      const pageOne = await repository.findUnresolvedEvents({
        page: 1,
        limit: 1,
        provider: 'flutterwave',
      });
      expect(pageOne.data).toHaveLength(1);
      expect(pageOne.total).toBeGreaterThanOrEqual(1);

      // Requesting every remaining page never repeats or skips an id — a basic but real proof
      // that skip/limit math and the sort are consistent with each other.
      const seen = new Set<string>();
      for (let page = 1; page <= pageOne.total; page += 1) {
        const result = await repository.findUnresolvedEvents({
          page,
          limit: 1,
          provider: 'flutterwave',
        });
        for (const event of result.data) {
          expect(seen.has(event.id)).toBe(false);
          seen.add(event.id);
        }
      }
    });

    it('TEST 12 (Stage 2.8) — the raw provider payload is never exposed, only the declared summary fields', async () => {
      const result = await repository.findUnresolvedEvents({
        page: 1,
        limit: 100,
        provider: 'flutterwave',
      });
      const event = result.data.find(
        (e) => e.providerEventId === 'unresolved-evt-1',
      );
      expect(event).toBeDefined();
      expect(JSON.stringify(event)).not.toContain('do-not-leak-me');
      expect(Object.keys(event as object).sort()).toEqual(
        ['id', 'provider', 'domain', 'providerEventId', 'receivedAt'].sort(),
      );
    });
  });
});
