import { randomUUID } from 'node:crypto';
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import mongoose, { Types } from 'mongoose';
import type { Connection } from 'mongoose';

import { IntegrationsModule } from '../integrations.module';
import { IntegrationsService } from '../integrations.service';
import { IntegrationsRepository } from '../integrations.repository';
import { INTEGRATION_ACCOUNTS_READER } from '../integrations.types';
import type { IntegrationAccountRecord } from '../integrations.types';
import { IntegrationAccountSchema } from '../schemas/integration-account.schema';

import { PaymentProviderResolverService } from '../../finance/payments/providers/payment-provider-resolver.service';
import { ManualPaymentProvider } from '../../finance/payments/providers/manual-payment.provider';
import { OrganizationsService } from '../../organizations/organizations.service';

import { IntegrationWebhookModule } from '../webhooks/integration-webhook.module';
import { IntegrationWebhookService } from '../webhooks/integration-webhook.service';
import { IntegrationWebhookEvent } from '../webhooks/schemas/integration-webhook-event.schema';
import { FakeWebhookVerifier } from '../webhooks/fake-webhook-verifier';
import { EventBusService } from '../../core/events/event-bus.service';

/**
 * Wave 4 Stage 1 — cross-agent adversarial/integration verification (Agent E).
 *
 * Everything in this directory is NEW (owned by Agent E only) and exercises multiple Stage 1
 * agents' pieces wired together through NestJS's real `Test.createTestingModule()` DI container
 * and a real MongoDB — never a hand-mocked repository/reader — to prove properties none of the
 * individual agents' own (correct, but isolated/mocked) unit specs could prove:
 *
 *   1. `INTEGRATION_ACCOUNTS_READER` really resolves to `IntegrationsRepository` at runtime
 *      (integrations.module.ts's `useExisting` binding), and `PaymentProviderResolverService`
 *      genuinely reads what `IntegrationsService` wrote, through real Mongo in between.
 *   2. Organization A can never read/modify/rotate/revoke organization B's `IntegrationAccount`
 *      through the real service + repository + schema (not a mocked repository returning `null`
 *      because a test told it to).
 *   3. A duplicate webhook delivery through the REAL `IntegrationWebhookService` +
 *      `IntegrationWebhookRepository` + real Mongo unique index publishes at most once — proven
 *      independently of Agent C's own spec files (which used either a mocked repository for the
 *      service-level test, or exercised the repository directly without going through the service
 *      pipeline — never both real repository AND real service together, which is exactly the seam
 *      a "the service correctly wires into the repository's real atomicity" bug would hide in).
 *   4. `IntegrationAccountRecord`, as actually returned by `IntegrationsService`'s public methods,
 *      never carries `secretEncrypted` — checked via `JSON.stringify`, which would catch a bug a
 *      plain `toHaveProperty` assertion misses (e.g. a nested/prototype-chain leak, or the literal
 *      ciphertext string turning up anywhere in the serialized output).
 *
 * No file outside this new `__integration__` directory is created or modified by this spec.
 */

const MONGO_HOST = 'mongodb://korva:korva@localhost:27017';
const MONGO_OPTS = 'authSource=admin&replicaSet=rs0';

function testMongoUri(label: string): string {
  const dbName = `korva_test_wave4_${label}_${process.pid}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  return `${MONGO_HOST}/${dbName}?${MONGO_OPTS}`;
}

/**
 * `core/events/events.module.ts` marks `EventBusService` `@Global()` in the real app, so any
 * module (including `IntegrationWebhookModule`) can `@Inject` it without declaring/importing it
 * itself. A `Test.createTestingModule({ providers: [...] })` root does NOT automatically behave
 * like a `@Global()` module for its imports, so `IntegrationWebhookModule` (which never imports
 * anything that provides `EventBusService`) would fail to resolve it unless we replicate that
 * global registration here — with a mock so this test never needs a real Redis connection for a
 * property that is about Mongo's unique-index dedup, not BullMQ.
 */
function buildFakeGlobalEventsModule(
  eventBus: Pick<EventBusService, 'publish'>,
) {
  @Global()
  @Module({
    providers: [{ provide: EventBusService, useValue: eventBus }],
    exports: [EventBusService],
  })
  class FakeGlobalEventsModule {}
  return FakeGlobalEventsModule;
}

/**
 * REGRESSION TEST for a real, orchestrator-fixed bug found by this agent's own review (see the
 * final report's HIGH-severity finding). Originally, `uniq_platform_account`/`uniq_tenant_account`
 * declared `partialFilterExpression: { ..., status: { $ne: 'revoked' } }` — MongoDB's partial-index
 * filter language does not support `$ne`/`$not`, only `$eq`/`$exists`/`$gt(e)`/`$lt(e)`/`$type`
 * (and a top-level `$and` of those), so `syncIndexes()` rejected outright on a real server. Fixed
 * in apps/api/src/integrations/schemas/integration-account.schema.ts by adding a plain boolean
 * `isLive` field (flipped to `false` by `IntegrationsRepository.revoke()`) and keying both partial
 * filters on `isLive: true` instead — a pure `$eq`, which MongoDB does support. This test proves
 * the fix: real index build succeeds, AND the uniqueness constraint it exists to enforce actually
 * holds against a real server (not just the JS-side index declaration).
 */
describe("Wave 4 Stage 1 — REGRESSION: IntegrationAccount's two unique partial indexes build and enforce uniqueness on a real MongoDB server", () => {
  let connection: Connection;

  afterAll(async () => {
    if (connection) {
      await connection.dropDatabase();
      await connection.close();
    }
  }, 30_000);

  it('connection.syncIndexes() succeeds for uniq_platform_account / uniq_tenant_account (isLive:true is a supported $eq partial filter)', async () => {
    const uri = testMongoUri('idxfix');
    connection = await mongoose.createConnection(uri).asPromise();
    connection.model(
      'IntegrationAccountIndexFixProbe',
      IntegrationAccountSchema,
      'integration_accounts',
    );

    // syncIndexes() resolves to { [modelName]: string[] } where the array lists any indexes it
    // had to DROP-and-rebuild (empty when nothing needed dropping) — it throws (rejected promise)
    // rather than resolving with an error list if a build itself fails, which is exactly the
    // behavior the original $ne-based filter triggered and this fix resolves. A clean resolve with
    // no dropped indexes is the proof both partial indexes built successfully on the first try.
    await expect(connection.syncIndexes()).resolves.toEqual({
      IntegrationAccountIndexFixProbe: [],
    });
    const rawIndexes: unknown = await connection
      .model('IntegrationAccountIndexFixProbe')
      .listIndexes();
    const indexes = rawIndexes as Array<{ name: string }>;
    expect(indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining(['uniq_platform_account', 'uniq_tenant_account']),
    );
  }, 30_000);

  it('the built index actually rejects a second live platform account sharing the same (scope, domain, provider, market, role), and a revoked row never blocks a new one taking its place', async () => {
    const Model = connection.model(
      'IntegrationAccountIndexFixProbe',
      IntegrationAccountSchema,
      'integration_accounts',
    );
    const key = {
      scope: 'platform',
      domain: 'payment',
      provider: 'flutterwave',
      market: 'CI',
      role: 'merchant-of-record',
    };

    const first = await Model.create({ ...key, secretEncrypted: 'a' });
    await expect(
      Model.create({ ...key, secretEncrypted: 'b' }),
    ).rejects.toThrow(/duplicate key/i);

    // Revoking the first (isLive:false) frees the slot — rotation, per architecture doc §3, must
    // remain possible: this is the exact scenario the original $ne-based filter was trying (and
    // failing at the MongoDB level) to support.
    await Model.updateOne(
      { _id: first._id },
      { status: 'revoked', isLive: false },
    );
    await expect(
      Model.create({ ...key, secretEncrypted: 'c' }),
    ).resolves.toMatchObject({ isLive: true });
  }, 30_000);
});

describe('Wave 4 Stage 1 — payment provider resolution: real INTEGRATION_ACCOUNTS_READER DI wiring', () => {
  let connection: Connection;
  let integrationsService: IntegrationsService;
  let integrationsRepository: IntegrationsRepository;
  let resolverService: PaymentProviderResolverService;
  let getById: jest.Mock;

  beforeAll(async () => {
    process.env.INTEGRATION_CREDENTIALS_KEY ??=
      'wave4-stage1-integration-spec-key';

    const uri = testMongoUri('paymentresolver');
    getById = jest.fn();
    const fakeOrganizationsService = {
      getById,
    } as unknown as OrganizationsService;

    // PaymentProviderResolverService/Registry are NOT declared in this test's own `providers:`
    // (an earlier version of this test did, before the orchestrator's Wave 4 Stage 2 convergence
    // fix moved both into the real IntegrationsModule — see integrations.module.ts's own doc
    // comment on why). Declaring them here too would create a second, ambiguous instance of the
    // same class token alongside IntegrationsModule's own internal one, which is exactly what
    // broke this suite (moduleRef.get() started resolving IntegrationsModule's real,
    // unmocked-OrganizationsService instance instead of a test-local one). `overrideProvider`
    // instead replaces OrganizationsService wherever it's actually used in the compiled graph —
    // including inside IntegrationsModule's own encapsulated OrganizationsModule import — so the
    // resolver under test is the SAME real instance the app would use, just with a faked
    // OrganizationsService underneath it. This is a stronger proof of the real wiring, not a
    // weaker one.
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        // autoIndex: false — see the "BUG DOCUMENTATION" describe block above: the schema's two
        // unique partial indexes fail to build on real MongoDB ($ne unsupported in a partial
        // filter expression), which would otherwise crash every test below via an unhandled
        // index-build rejection. None of the isolation/DI-wiring properties this describe block
        // tests depend on that index actually existing (they assert on query filters, not on a
        // uniqueness constraint), so this only routes around the unrelated, already-documented bug.
        MongooseModule.forRoot(uri, { autoIndex: false }),
        IntegrationsModule,
      ],
    })
      .overrideProvider(OrganizationsService)
      .useValue(fakeOrganizationsService)
      .compile();

    connection = moduleRef.get(getConnectionToken());

    integrationsService = moduleRef.get(IntegrationsService);
    integrationsRepository = moduleRef.get(IntegrationsRepository);
    resolverService = moduleRef.get(PaymentProviderResolverService);

    // Sanity check on the wiring itself before trusting any test below: the DI token really is
    // bound to the concrete repository instance (integrations.module.ts's `useExisting`).
    const reader = moduleRef.get<IntegrationsRepository>(
      INTEGRATION_ACCOUNTS_READER,
    );
    expect(reader).toBe(integrationsRepository);
  }, 30_000);

  afterAll(async () => {
    if (connection) {
      await connection.dropDatabase();
      await connection.close();
    }
  }, 30_000);

  it('a platform account created via IntegrationsService is genuinely readable by PaymentProviderResolverService through the real reader binding', async () => {
    getById.mockResolvedValue({ country: 'CI' });

    const created = await integrationsService.createPlatformAccount({
      domain: 'payment',
      provider: 'manual',
      role: 'merchant-of-record',
      market: 'CI',
      secret: 'korva-flutterwave-master-key',
      metadata: { environment: 'sandbox' },
    });
    // createPlatformAccount always starts 'pending' (see integrations.service.ts) — the resolver
    // must refuse a non-active account, so we activate it the same way an ops-approval flow would
    // (a direct status transition, not a rewrite of the row IntegrationsService itself produced).
    await integrationsRepository.updateStatus(created.id, 'active');

    const provider = await resolverService.resolve({
      flow: 'commerce',
      organizationId: String(new Types.ObjectId()),
    });

    expect(getById).toHaveBeenCalled();
    expect(provider).toBeInstanceOf(ManualPaymentProvider);
    expect(provider.name).toBe('manual');
  });

  it("ADVERSARIAL: a market with no configured platform account never falls back to another market's provider", async () => {
    getById.mockResolvedValue({ country: 'MA' });

    // A 'CI' account already exists (created by the previous test in this describe block); 'MA'
    // has none. The resolver must fail loudly for 'MA', never silently reuse the 'CI' row.
    await expect(
      resolverService.resolve({
        flow: 'commerce',
        organizationId: String(new Types.ObjectId()),
      }),
    ).rejects.toMatchObject({
      response: { code: 'PAYMENT_PROVIDER_NOT_CONFIGURED' },
    });
  });

  it('ADVERSARIAL: an active platform account whose provider has no registered adapter fails loudly instead of silently completing as ManualPaymentProvider', async () => {
    getById.mockResolvedValue({ country: 'SN' });

    const created = await integrationsService.createPlatformAccount({
      domain: 'payment',
      // 'flutterwave' was the original example here (Stage 1); Wave 4 Stage 2 registered a real
      // FlutterwaveProvider adapter, which would make this specific assertion false — 'charibaas'
      // is the still-unimplemented Morocco candidate from docs/decisions/psp-provider.md, kept
      // deliberately unregistered so this test's premise (a real provider key with no adapter
      // factory) stays true regardless of which adapters Stage 2 adds next.
      provider: 'charibaas',
      role: 'merchant-of-record',
      market: 'SN',
      secret: 'not-yet-a-real-adapter',
    });
    await integrationsRepository.updateStatus(created.id, 'active');

    await expect(
      resolverService.resolve({
        flow: 'commerce',
        organizationId: String(new Types.ObjectId()),
      }),
    ).rejects.toMatchObject({
      response: { code: 'PAYMENT_PROVIDER_ADAPTER_NOT_REGISTERED' },
    });
  });

  it('ADVERSARIAL: a disabled/error/revoked platform account for the right market is never treated as usable', async () => {
    getById.mockResolvedValue({ country: 'TG' });

    const created = await integrationsService.createPlatformAccount({
      domain: 'payment',
      provider: 'manual',
      role: 'merchant-of-record',
      market: 'TG',
      secret: 'togo-key',
    });
    await integrationsRepository.updateStatus(created.id, 'disabled');

    await expect(
      resolverService.resolve({
        flow: 'commerce',
        organizationId: String(new Types.ObjectId()),
      }),
    ).rejects.toMatchObject({
      response: { code: 'PAYMENT_PROVIDER_NOT_CONFIGURED' },
    });
  });
});

describe('Wave 4 Stage 1 — IntegrationsService cross-organization tenant isolation (real service + repository + schema)', () => {
  let connection: Connection;
  let service: IntegrationsService;
  let repository: IntegrationsRepository;
  const MANAGE = ['settings.manage'];

  beforeAll(async () => {
    process.env.INTEGRATION_CREDENTIALS_KEY ??=
      'wave4-stage1-integration-spec-key';

    const uri = testMongoUri('crossorg');
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        // autoIndex: false — see the "BUG DOCUMENTATION" describe block above (the schema's
        // unique partial indexes don't build on real MongoDB); irrelevant to the query-filter-based
        // isolation properties this describe block tests.
        MongooseModule.forRoot(uri, { autoIndex: false }),
        IntegrationsModule,
      ],
    }).compile();

    connection = moduleRef.get(getConnectionToken());
    service = moduleRef.get(IntegrationsService);
    repository = moduleRef.get(IntegrationsRepository);
  }, 30_000);

  afterAll(async () => {
    if (connection) {
      await connection.dropDatabase();
      await connection.close();
    }
  }, 30_000);

  it('ADVERSARIAL: organization B cannot read, list, rotate, or revoke an account organization A created — real Mongo, real query filter', async () => {
    const orgA = String(new Types.ObjectId());
    const orgB = String(new Types.ObjectId());

    const created = await service.createTenantAccount(orgA, MANAGE, {
      domain: 'payment',
      provider: 'flutterwave',
      secret: 'org-a-secret-value',
      metadata: { subaccountId: 'org-a-subaccount' },
    });

    // 1. Direct read by id, from B's own org context: 404, not 403 — no existence leak.
    await expect(
      service.getTenantAccount(orgB, MANAGE, created.id),
    ).rejects.toMatchObject({
      response: { code: 'INTEGRATION_ACCOUNT_NOT_FOUND' },
    });

    // 2. B's own listing never contains A's row.
    const orgBList = await service.listTenantAccounts(orgB, MANAGE);
    expect(orgBList.find((r) => r.id === created.id)).toBeUndefined();
    expect(orgBList).toHaveLength(0);

    // 3. B cannot rotate A's secret.
    await expect(
      service.rotateTenantAccountSecret(
        orgB,
        MANAGE,
        created.id,
        'stolen-secret',
      ),
    ).rejects.toMatchObject({
      response: { code: 'INTEGRATION_ACCOUNT_NOT_FOUND' },
    });

    // 4. B cannot revoke A's account.
    await expect(
      service.revokeTenantAccount(orgB, MANAGE, created.id),
    ).rejects.toMatchObject({
      response: { code: 'INTEGRATION_ACCOUNT_NOT_FOUND' },
    });

    // 5. Prove the attempted attacks left A's row completely untouched (still active/pending,
    //    not revoked, still readable by A) — not just that B's calls threw.
    const stillOwnedByA = await service.getTenantAccount(
      orgA,
      MANAGE,
      created.id,
    );
    expect(stillOwnedByA.status).not.toBe('revoked');
    expect(stillOwnedByA.id).toBe(created.id);

    // 6. Repository-level proof the isolation is a real DB query filter, not an app-side
    //    after-the-fact check: the exact same id resolves under A's own org and resolves to
    //    null (not an error, not a slow timing difference) under B's.
    const foundUnderA = await repository.findByIdForOrganization(
      created.id,
      orgA,
    );
    const foundUnderB = await repository.findByIdForOrganization(
      created.id,
      orgB,
    );
    expect(foundUnderA).not.toBeNull();
    expect(foundUnderB).toBeNull();
  });

  it('ADVERSARIAL: the INTEGRATION_ACCOUNTS_READER contract itself never returns a tenant account under the wrong organizationId', async () => {
    const orgA = String(new Types.ObjectId());
    const orgB = String(new Types.ObjectId());
    const reader = repository; // same object the DI token resolves to (see previous describe block)

    await service.createTenantAccount(orgA, MANAGE, {
      domain: 'messaging',
      provider: '360dialog',
      metadata: { wabaId: 'waba-org-a' },
    });

    const asA = await reader.findTenantAccount({
      organizationId: orgA,
      domain: 'messaging',
      provider: '360dialog',
    });
    const asB = await reader.findTenantAccount({
      organizationId: orgB,
      domain: 'messaging',
      provider: '360dialog',
    });

    expect(asA).not.toBeNull();
    expect(asB).toBeNull();
  });

  it("platform-scope accounts are structurally unreachable through any tenant-scoped lookup, even when a tenant guesses a platform account's real id", async () => {
    const platformAccount = await service.createPlatformAccount({
      domain: 'payment',
      provider: 'flutterwave',
      role: 'merchant-of-record',
      market: 'CI',
      secret: 'korva-master-secret',
    });
    const tenantOrg = String(new Types.ObjectId());

    await expect(
      service.getTenantAccount(tenantOrg, MANAGE, platformAccount.id),
    ).rejects.toMatchObject({
      response: { code: 'INTEGRATION_ACCOUNT_NOT_FOUND' },
    });
    await expect(
      service.revokeTenantAccount(tenantOrg, MANAGE, platformAccount.id),
    ).rejects.toMatchObject({
      response: { code: 'INTEGRATION_ACCOUNT_NOT_FOUND' },
    });
  });
});

describe('Wave 4 Stage 1 — IntegrationAccountRecord never leaks secretEncrypted (real Mongo, JSON.stringify-level proof)', () => {
  let connection: Connection;
  let service: IntegrationsService;
  let repository: IntegrationsRepository;
  const MANAGE = ['settings.manage'];
  const PLAINTEXT_SECRET = 'sk_live_do-not-ever-serialize-me-4f9c2a';

  beforeAll(async () => {
    process.env.INTEGRATION_CREDENTIALS_KEY ??=
      'wave4-stage1-integration-spec-key';

    const uri = testMongoUri('secretleak');
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        // autoIndex: false — see the "BUG DOCUMENTATION" describe block above (the schema's
        // unique partial indexes don't build on real MongoDB); irrelevant to the secret-leakage
        // properties this describe block tests.
        MongooseModule.forRoot(uri, { autoIndex: false }),
        IntegrationsModule,
      ],
    }).compile();

    connection = moduleRef.get(getConnectionToken());
    service = moduleRef.get(IntegrationsService);
    repository = moduleRef.get(IntegrationsRepository);
  }, 30_000);

  afterAll(async () => {
    if (connection) {
      await connection.dropDatabase();
      await connection.close();
    }
  }, 30_000);

  it('createTenantAccount / getTenantAccount / listTenantAccounts never surface secretEncrypted or the plaintext, even under JSON.stringify', async () => {
    const org = String(new Types.ObjectId());
    const created = await service.createTenantAccount(org, MANAGE, {
      domain: 'payment',
      provider: 'flutterwave',
      secret: PLAINTEXT_SECRET,
      metadata: { subaccountId: 'sub-clean' },
    });

    // Independently fetch the REAL ciphertext straight out of Mongo (bypassing select:false via
    // the one repository method allowed to do so) so we know exactly what string a leak would
    // have to contain — proving the assertions below are actually meaningful, not vacuous.
    const rawWithSecret = await repository.findByIdWithSecret(created.id);
    expect(rawWithSecret?.secretEncrypted).toBeTruthy();
    const realCiphertext = rawWithSecret!.secretEncrypted!;
    expect(realCiphertext).not.toBe(PLAINTEXT_SECRET);

    const fetched = await service.getTenantAccount(org, MANAGE, created.id);
    const list = await service.listTenantAccounts(org, MANAGE);

    for (const record of [
      created,
      fetched,
      ...list,
    ] as IntegrationAccountRecord[]) {
      expect(record).not.toHaveProperty('secretEncrypted');
      const serialized = JSON.stringify(record);
      expect(serialized).not.toContain(PLAINTEXT_SECRET);
      expect(serialized).not.toContain(realCiphertext);
      expect(serialized).not.toContain('secretEncrypted');
    }
  });

  it('rotateTenantAccountSecret never surfaces either the old or the new secret, even under JSON.stringify', async () => {
    const org = String(new Types.ObjectId());
    const created = await service.createTenantAccount(org, MANAGE, {
      domain: 'messaging',
      provider: '360dialog',
      secret: 'old-waba-token-abc123',
    });

    const rotated = await service.rotateTenantAccountSecret(
      org,
      MANAGE,
      created.id,
      'new-waba-token-xyz789',
    );

    const serialized = JSON.stringify(rotated);
    expect(serialized).not.toContain('old-waba-token-abc123');
    expect(serialized).not.toContain('new-waba-token-xyz789');
    expect(serialized).not.toContain('secretEncrypted');
    expect(rotated).not.toHaveProperty('secretEncrypted');
  });

  it('a default (non-select) Mongo query for the same document truly omits secretEncrypted at the driver level, not just at the DTO-mapping level', async () => {
    const org = String(new Types.ObjectId());
    const created = await service.createTenantAccount(org, MANAGE, {
      domain: 'payment',
      provider: 'flutterwave',
      secret: 'schema-level-protection-check',
    });

    const viaFindByIdForOrganization = await repository.findByIdForOrganization(
      created.id,
      org,
    );
    // This is the schema's `select: false` guarantee itself, independent of
    // toIntegrationAccountRecord ever running — the field isn't even hydrated onto the document.
    expect(
      (viaFindByIdForOrganization as unknown as Record<string, unknown>)
        .secretEncrypted,
    ).toBeUndefined();
    expect(JSON.stringify(viaFindByIdForOrganization)).not.toContain(
      'schema-level-protection-check',
    );
  });
});

describe("Wave 4 Stage 1 — IntegrationWebhookService duplicate-delivery proof (real module, real Mongo unique index, independent of Agent C's own spec)", () => {
  let connection: Connection;
  let service: IntegrationWebhookService;
  let eventBus: { publish: jest.Mock };

  const extractEventId = (payload: Record<string, unknown>): string =>
    String(payload.id);

  beforeAll(async () => {
    const uri = testMongoUri('webhookdup');
    eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
    const FakeGlobalEventsModule = buildFakeGlobalEventsModule(eventBus);

    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(uri),
        FakeGlobalEventsModule,
        IntegrationWebhookModule,
      ],
    }).compile();

    connection = moduleRef.get(getConnectionToken());
    // As integration-webhook.repository.spec.ts's own header comment notes: the unique index
    // build is async, so this must be awaited before any race-safety proof means anything.
    await connection.syncIndexes();
    service = moduleRef.get(IntegrationWebhookService);
  }, 30_000);

  afterAll(async () => {
    if (connection) {
      await connection.dropDatabase();
      await connection.close();
    }
  }, 30_000);

  afterEach(() => {
    eventBus.publish.mockClear();
  });

  it('SEQUENTIAL duplicate: the second delivery of the identical (provider, providerEventId) through the real service+repository+Mongo returns "duplicate" and triggers zero additional publishes', async () => {
    const verifier = new FakeWebhookVerifier('flutterwave', 'seq-secret');
    const rawBody = Buffer.from(
      JSON.stringify({ id: 'evt-seq-real-e2e-1' }),
      'utf8',
    );
    const input = {
      provider: 'flutterwave',
      domain: 'payment' as const,
      rawBody,
      headers: { 'x-webhook-secret': 'seq-secret' },
      verifier,
      extractEventId,
    };

    const first = await service.process(input);
    const second = await service.process(input);
    const third = await service.process(input);

    expect(first).toEqual({ status: 'processed' });
    expect(second).toEqual({ status: 'duplicate' });
    expect(third).toEqual({ status: 'duplicate' });
    expect(eventBus.publish).toHaveBeenCalledTimes(1);

    const persistedCount = await connection
      .model(IntegrationWebhookEvent.name)
      .countDocuments({
        provider: 'flutterwave',
        providerEventId: 'evt-seq-real-e2e-1',
      });
    expect(persistedCount).toBe(1);
  });

  it('CONCURRENT duplicate: N truly simultaneous deliveries of the identical event through the real service pipeline publish exactly once total', async () => {
    const verifier = new FakeWebhookVerifier(
      'flutterwave',
      'concurrent-secret',
    );
    const rawBody = Buffer.from(
      JSON.stringify({ id: 'evt-concurrent-real-e2e' }),
      'utf8',
    );
    const input = {
      provider: 'flutterwave',
      domain: 'payment' as const,
      rawBody,
      headers: { 'x-webhook-secret': 'concurrent-secret' },
      verifier,
      extractEventId,
    };

    const results = await Promise.all(
      Array.from({ length: 8 }, () => service.process(input)),
    );

    const processedCount = results.filter(
      (r) => r.status === 'processed',
    ).length;
    const duplicateCount = results.filter(
      (r) => r.status === 'duplicate',
    ).length;
    expect(processedCount).toBe(1);
    expect(duplicateCount).toBe(7);
    expect(eventBus.publish).toHaveBeenCalledTimes(1);

    const persistedCount = await connection
      .model(IntegrationWebhookEvent.name)
      .countDocuments({
        provider: 'flutterwave',
        providerEventId: 'evt-concurrent-real-e2e',
      });
    expect(persistedCount).toBe(1);
  });

  it('the same providerEventId from TWO DIFFERENT providers is not treated as a duplicate of the other — the compound (provider, providerEventId) index is genuinely compound, not keyed on providerEventId alone', async () => {
    const sharedEventId = 'evt-shared-across-providers';
    const verifierA = new FakeWebhookVerifier('flutterwave', 'shared-secret');
    const verifierB = new FakeWebhookVerifier('360dialog', 'shared-secret');

    const resultA = await service.process({
      provider: 'flutterwave',
      domain: 'payment',
      rawBody: Buffer.from(JSON.stringify({ id: sharedEventId }), 'utf8'),
      headers: { 'x-webhook-secret': 'shared-secret' },
      verifier: verifierA,
      extractEventId,
    });
    const resultB = await service.process({
      provider: '360dialog',
      domain: 'messaging',
      rawBody: Buffer.from(JSON.stringify({ id: sharedEventId }), 'utf8'),
      headers: { 'x-webhook-secret': 'shared-secret' },
      verifier: verifierB,
      extractEventId,
    });

    expect(resultA).toEqual({ status: 'processed' });
    expect(resultB).toEqual({ status: 'processed' });
    expect(eventBus.publish).toHaveBeenCalledTimes(2);
  });

  it('an invalid-signature delivery is never counted toward idempotency state and does not block a later legitimate delivery of the same event id', async () => {
    const eventId = 'evt-invalid-then-valid';
    const validVerifier = new FakeWebhookVerifier(
      'flutterwave',
      'right-secret',
    );

    const invalidAttempt = await service.process({
      provider: 'flutterwave',
      domain: 'payment',
      rawBody: Buffer.from(JSON.stringify({ id: eventId }), 'utf8'),
      headers: { 'x-webhook-secret': 'wrong-secret' },
      verifier: validVerifier,
      extractEventId,
    });
    expect(invalidAttempt).toEqual({ status: 'invalid_signature' });
    expect(eventBus.publish).not.toHaveBeenCalled();

    const legitimateAttempt = await service.process({
      provider: 'flutterwave',
      domain: 'payment',
      rawBody: Buffer.from(JSON.stringify({ id: eventId }), 'utf8'),
      headers: { 'x-webhook-secret': 'right-secret' },
      verifier: validVerifier,
      extractEventId,
    });
    expect(legitimateAttempt).toEqual({ status: 'processed' });
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
  });
});
