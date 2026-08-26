import { randomUUID } from 'node:crypto';
import mongoose, { Connection } from 'mongoose';
import {
  IntegrationWebhookEvent,
  IntegrationWebhookEventSchema,
} from './integration-webhook-event.schema';

/**
 * The property under test here — a duplicate (provider, providerEventId) can never be inserted
 * twice — is enforced by a REAL MongoDB unique index, not by application code (there is no
 * pre-insert existence check anywhere in this pipeline; see integration-webhook.repository.ts's
 * own comment on why a read-then-write would be a race). A mocked/in-memory model can't prove
 * this: it would happily accept two inserts unless a real server actually builds and enforces the
 * index. This repo has no mongodb-memory-server dependency and no other schema/repository spec
 * anywhere in apps/api/src exercises a real index — the existing convention (see
 * payment.schema.ts, workflow-action-claim.schema.ts) is to prove unique-index/concurrency
 * behavior only in apps/api/test/*.e2e-spec.ts against the docker-compose MongoDB. Since the task
 * explicitly asks for this proof in a *.spec.ts file living next to the schema, this file
 * self-connects to that same already-running MongoDB (docker-compose.yml's `mongodb` service,
 * the same one apps/api/test/env.setup.ts points e2e tests at) using its own dedicated,
 * randomly-named database — dropped in afterAll — so it never collides with dev data or a
 * concurrent test run.
 */
const uri = `mongodb://korva:korva@localhost:27017/korva_test_iwe_schema_${process.pid}_${randomUUID().replace(/-/g, '').slice(0, 12)}?authSource=admin&replicaSet=rs0`;

describe('IntegrationWebhookEventSchema (real MongoDB unique index)', () => {
  let connection: Connection;
  let model: mongoose.Model<IntegrationWebhookEvent>;

  beforeAll(async () => {
    connection = await mongoose.createConnection(uri).asPromise();
    model = connection.model(
      IntegrationWebhookEvent.name,
      IntegrationWebhookEventSchema,
    );
    // Guarantees the unique index is actually built before any test runs — Model.init()
    // resolves only once index creation has completed, unlike a bare `create()` call, which
    // could otherwise race the (async) index build the very first time this collection is used.
    await model.init();
  }, 30_000);

  afterAll(async () => {
    if (connection) {
      await connection.dropDatabase();
      await connection.close();
    }
  }, 30_000);

  it('TEST 1 — accepts the first delivery of a given (provider, providerEventId)', async () => {
    const doc = await model.create({
      provider: 'flutterwave',
      providerEventId: 'evt-unique-1',
      domain: 'payment',
      payload: { foo: 'bar' },
      receivedAt: new Date(),
    });

    expect(doc.provider).toBe('flutterwave');
    expect(doc.providerEventId).toBe('evt-unique-1');
  });

  it('TEST 2 — rejects a second insert with the same (provider, providerEventId) — real E11000', async () => {
    await model.create({
      provider: 'flutterwave',
      providerEventId: 'evt-dup-1',
      domain: 'payment',
      payload: { attempt: 1 },
      receivedAt: new Date(),
    });

    await expect(
      model.create({
        provider: 'flutterwave',
        providerEventId: 'evt-dup-1',
        domain: 'payment',
        payload: { attempt: 2 },
        receivedAt: new Date(),
      }),
    ).rejects.toMatchObject({ code: 11000 });

    const count = await model.countDocuments({
      provider: 'flutterwave',
      providerEventId: 'evt-dup-1',
    });
    expect(count).toBe(1);
  });

  it('TEST 3 — the same providerEventId is allowed again for a DIFFERENT provider (index is compound, not on providerEventId alone)', async () => {
    await model.create({
      provider: 'flutterwave',
      providerEventId: 'evt-shared-id',
      domain: 'payment',
      payload: {},
      receivedAt: new Date(),
    });

    const otherProviderDoc = await model.create({
      provider: '360dialog',
      providerEventId: 'evt-shared-id',
      domain: 'messaging',
      payload: {},
      receivedAt: new Date(),
    });

    expect(otherProviderDoc.provider).toBe('360dialog');
  });
});
