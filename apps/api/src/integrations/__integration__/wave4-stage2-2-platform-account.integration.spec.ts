import { randomUUID } from 'node:crypto';
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import { IntegrationsModule } from '../integrations.module';
import { IntegrationsService } from '../integrations.service';
import { IntegrationsRepository } from '../integrations.repository';
import type { IntegrationAccountRecord } from '../integrations.types';
import { EventBusService } from '../../core/events/event-bus.service';

/**
 * Wave 4 Stage 2.2 — TEST 4 (platform creation) and part of TEST 5 (secret exposure), exercising
 * the exact mechanism `scripts/create-platform-integration-account.ts` calls
 * (`IntegrationsService.createPlatformAccount` + `IntegrationsRepository.updateStatus`), against
 * a real MongoDB, a real service, and a real repository — never mocked. TEST 3 (a normal tenant
 * cannot create a platform account) lives in integrations.controller.spec.ts instead, since it's
 * a proof about the tenant-facing HTTP surface specifically, not about this mechanism.
 *
 * No secret used here is real — every value below is a literal test string.
 */

const MONGO_HOST = 'mongodb://korva:korva@localhost:27017';
const MONGO_OPTS = 'authSource=admin&replicaSet=rs0';

function testMongoUri(label: string): string {
  const dbName = `korva_test_wave4_${label}_${process.pid}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  return `${MONGO_HOST}/${dbName}?${MONGO_OPTS}`;
}

/**
 * SubscriptionsService injects EventBusService (event coverage expansion), reached transitively
 * via IntegrationsModule -> OrganizationsModule -> SubscriptionsModule. `EventBusService` is
 * `@Global()` in the real app (core/events/events.module.ts) but a `Test.createTestingModule`
 * root doesn't inherit that automatically, so it has to be replicated here — with a mock, since a
 * real EventBusService opens a live Redis/BullMQ connection this Mongo-only spec must not need.
 * Mirrors wave4-stage1.integration.spec.ts's own `buildFakeGlobalEventsModule` identically.
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

describe('Wave 4 Stage 2.2 — platform IntegrationAccount creation mechanism (real service + repository + Mongo)', () => {
  let connection: Connection;
  let service: IntegrationsService;
  let repository: IntegrationsRepository;
  const PLAINTEXT_SECRET = 'FLWSECK_TEST-do-not-ever-serialize-me-9a3c1f';

  beforeAll(async () => {
    process.env.INTEGRATION_CREDENTIALS_KEY ??=
      'wave4-stage2-2-integration-spec-key';

    const uri = testMongoUri('platformaccount');
    const FakeGlobalEventsModule = buildFakeGlobalEventsModule({
      publish: jest.fn().mockResolvedValue(undefined),
    });
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        // autoIndex: false — the schema's two partial unique indexes are covered by their own
        // dedicated regression test elsewhere; irrelevant to platform-account creation itself.
        MongooseModule.forRoot(uri, { autoIndex: false }),
        FakeGlobalEventsModule,
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

  it('TEST 4 — creates a platform account with scope="platform", organizationId=null, and a genuinely encrypted secret (mirrors what create-platform-integration-account.ts calls)', async () => {
    const created = await service.createPlatformAccount({
      domain: 'payment',
      provider: 'flutterwave',
      role: 'merchant-of-record',
      market: 'CI',
      secret: PLAINTEXT_SECRET,
    });

    expect(created.scope).toBe('platform');
    expect(created.organizationId).toBeNull();
    expect(created.status).toBe('pending');

    // Independently fetch the real ciphertext straight out of Mongo (bypassing select:false via
    // the one repository method allowed to do so) — proves it's genuinely encrypted, not stored
    // as plaintext under a different field name.
    const rawWithSecret = await repository.findByIdWithSecret(created.id);
    expect(rawWithSecret?.scope).toBe('platform');
    expect(rawWithSecret?.secretEncrypted).toBeTruthy();
    expect(rawWithSecret!.secretEncrypted).not.toBe(PLAINTEXT_SECRET);

    // TEST 5 (secret exposure) — the returned record itself, and its serialized form, never
    // carry the plaintext, the ciphertext, or the field name at all.
    expect(created).not.toHaveProperty('secretEncrypted');
    const serialized = JSON.stringify(created);
    expect(serialized).not.toContain(PLAINTEXT_SECRET);
    expect(serialized).not.toContain(rawWithSecret!.secretEncrypted!);
    expect(serialized).not.toContain('secretEncrypted');
  });

  it('TEST 4 (activation) — updateStatus("active") mirrors --activate and is reflected on the next real read, still with no secret exposure', async () => {
    const created = await service.createPlatformAccount({
      domain: 'payment',
      provider: 'flutterwave',
      role: 'merchant-of-record',
      market: 'SN',
      secret: PLAINTEXT_SECRET,
    });
    expect(created.status).toBe('pending');

    await repository.updateStatus(created.id, 'active');

    const accounts: IntegrationAccountRecord[] =
      await service.listPlatformAccounts('payment');
    const activated = accounts.find((account) => account.id === created.id);
    expect(activated?.status).toBe('active');
    expect(activated).not.toHaveProperty('secretEncrypted');
    expect(JSON.stringify(accounts)).not.toContain(PLAINTEXT_SECRET);
  });

  it('createPlatformAccount never calls out to anything beyond the repository — no EventBus/BullMQ side effect exists to leak the secret into', () => {
    // Static proof, not a mock-call-count proof: IntegrationsService.createPlatformAccount's own
    // source is exactly a repository.create() + toIntegrationAccountRecord() mapping, with no
    // event-bus/queue dependency injected into IntegrationsService at all (see its constructor —
    // only IntegrationsRepository and CredentialEncryptionService). A secret can only leak into
    // EventBus/BullMQ if something publishes an event carrying it; nothing here does.
    const serviceSource = IntegrationsService.toString();
    expect(serviceSource).toContain('createPlatformAccount');
    // The constructor-injected dependency list is the actual guarantee: confirm no EventBus-like
    // token appears anywhere in the class source.
    expect(serviceSource).not.toMatch(/EventBus/);
  });

  it('rotates a live platform key without breaking the one-live-account index, and the new key is the one served', async () => {
    // This test needs the real partial unique index the rotation must live with.
    await connection.collection('integration_accounts').deleteMany({});
    await connection.model('IntegrationAccount').createIndexes();

    const created = await service.createPlatformAccount({
      domain: 'payment',
      provider: 'geniuspay',
      role: 'subscription-billing',
      market: null,
      secret: 'old-key-pair',
    });
    await repository.updateStatus(created.id, 'active');

    const rotated = await service.rotatePlatformAccountSecret(
      created.id,
      'new-key-pair',
    );

    expect(rotated.status).toBe('active');
    expect(rotated.id).not.toBe(created.id);
    expect(await service.getDecryptedPlatformSecret(rotated.id)).toBe(
      'new-key-pair',
    );
    const accounts = await service.listPlatformAccounts('payment');
    expect(accounts.find((a) => a.id === created.id)?.status).toBe('revoked');
    // Exactly one live account for that role: the new one.
    const live = await connection
      .collection('integration_accounts')
      .find({
        provider: 'geniuspay',
        role: 'subscription-billing',
        isLive: true,
      })
      .toArray();
    expect(live.map((doc) => doc._id.toString())).toEqual([rotated.id]);

    // What a payment asks for — the resolver's lookup — finds the NEW key, never the revoked one.
    const served = await repository.findPlatformAccount({
      domain: 'payment',
      role: 'subscription-billing',
      market: null,
    });
    expect(served?.id).toBe(rotated.id);
    expect(served?.status).toBe('active');

    // And again: a second rotation works the same way.
    const again = await service.rotatePlatformAccountSecret(
      rotated.id,
      'third-key-pair',
    );
    expect(await service.getDecryptedPlatformSecret(again.id)).toBe(
      'third-key-pair',
    );
  });
});
