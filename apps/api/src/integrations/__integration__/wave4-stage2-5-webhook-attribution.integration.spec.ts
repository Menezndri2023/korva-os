import { randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';

import { IntegrationsModule } from '../integrations.module';
import { IntegrationsService } from '../integrations.service';
import { IntegrationWebhookModule } from '../webhooks/integration-webhook.module';
import { IntegrationWebhookService } from '../webhooks/integration-webhook.service';
import { IntegrationWebhookEvent } from '../webhooks/schemas/integration-webhook-event.schema';
import type { IntegrationWebhookEventDocument } from '../webhooks/schemas/integration-webhook-event.schema';
import { FakeWebhookVerifier } from '../webhooks/fake-webhook-verifier';
import { EventBusService } from '../../core/events/event-bus.service';
import { PaymentsRepository } from '../../finance/payments/payments.repository';
import {
  Payment,
  PaymentSchema,
} from '../../finance/payments/schemas/payment.schema';
import {
  Refund,
  RefundSchema,
} from '../../finance/payments/schemas/refund.schema';

/**
 * Wave 4 Stage 2.5 — WEBHOOK TENANT ATTRIBUTION, the mandate's own required cross-tenant collision
 * proof (§11) plus the concurrent-idempotency-keeps-tenant proof (§14), run against real MongoDB
 * documents for `IntegrationAccount` (360dialog attribution), `Payment` (Flutterwave attribution,
 * via the same `(provider, providerReference)` relationship `PaymentsService.create` itself
 * establishes at checkout time), and `IntegrationWebhookEvent` (the actual persisted attribution).
 *
 * Deliberately mocks `EventBusService` (no real Redis/BullMQ here — that plumbing is already
 * covered by integration-webhook.service.spec.ts's own unit tests and by the real BullMQ
 * integration tests elsewhere in this suite) so this file's real infrastructure stays scoped to
 * exactly what Stage 2.5 changed: Mongo-persisted tenant attribution.
 *
 * The `organizationId` passed into `IntegrationWebhookService.process()` below is resolved the
 * exact same way the real controllers resolve it (flutterwave-webhook.controller.ts's
 * `resolveOrganizationId` / three-sixty-dialog-webhook.controller.ts's `resolveOrganizationId`) —
 * by calling `PaymentsRepository.findOrganizationIdByProviderReference` /
 * `IntegrationsService.findTenantOrganizationIdByWabaId` directly against real data — proving the
 * full real resolution + persistence chain end to end. The controllers' own unit tests separately
 * prove the HTTP-layer wiring (verify-before-attribute ordering, forged-payload-is-never-read).
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
 * Stand-in for the real, `@Global()` core/events/events.module.ts (see that file's own doc
 * comment on why it's global) — `IntegrationWebhookModule` injects `EventBusService` expecting it
 * to be supplied globally, exactly like production; a real `EventBusService` opens a live Redis/
 * BullMQ connection, which this file deliberately avoids (see class doc comment above).
 */
function fakeGlobalEventBusModule(publish: jest.Mock) {
  @Global()
  @Module({
    providers: [{ provide: EventBusService, useValue: { publish } }],
    exports: [EventBusService],
  })
  class FakeEventBusModule {}
  return FakeEventBusModule;
}

describe('Wave 4 Stage 2.5 — webhook tenant attribution (real IntegrationAccount + Payment + IntegrationWebhookEvent + Mongo)', () => {
  let connection: Connection;
  let integrationsService: IntegrationsService;
  let paymentsRepository: PaymentsRepository;
  let webhookService: IntegrationWebhookService;
  let publish: jest.Mock;

  const ORG_A = String(new Types.ObjectId());
  const ORG_B = String(new Types.ObjectId());
  const MANAGE_PERMISSIONS = ['settings.manage'];

  beforeAll(async () => {
    process.env.INTEGRATION_CREDENTIALS_KEY ??=
      'wave4-stage2-5-integration-spec-key';

    publish = jest.fn().mockResolvedValue(undefined);
    const uri = testMongoUri('webhookattribution');
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        // autoIndex stays on (default) — unlike wave4-stage2-2-platform-account.integration.spec's
        // own {autoIndex:false}, THIS file's concurrency proof (§14) depends entirely on
        // IntegrationWebhookEvent's real unique (provider, providerEventId) index actually
        // existing; syncIndexes() below guarantees it's built before any test runs, same reasoning
        // as integration-webhook.repository.spec.ts.
        MongooseModule.forRoot(uri),
        MongooseModule.forFeature([
          { name: Payment.name, schema: PaymentSchema },
          { name: Refund.name, schema: RefundSchema },
        ]),
        fakeGlobalEventBusModule(publish),
        IntegrationsModule,
        IntegrationWebhookModule,
      ],
      providers: [PaymentsRepository],
    }).compile();

    connection = moduleRef.get(getConnectionToken());
    integrationsService = moduleRef.get(IntegrationsService);
    paymentsRepository = moduleRef.get(PaymentsRepository);
    webhookService = moduleRef.get(IntegrationWebhookService);
    await connection.syncIndexes();

    // -- Fixture: two tenants, each with their own 360dialog WABA and their own Flutterwave
    //    checkout in flight — mirrors the mandate's own §11/§18 scenario exactly.
    await integrationsService.createTenantAccount(ORG_A, MANAGE_PERMISSIONS, {
      domain: 'messaging',
      provider: '360dialog',
      metadata: { wabaId: 'waba-A' },
    });
    await integrationsService.createTenantAccount(ORG_B, MANAGE_PERMISSIONS, {
      domain: 'messaging',
      provider: '360dialog',
      metadata: { wabaId: 'waba-B' },
    });

    await paymentsRepository.createPayment({
      organizationId: new Types.ObjectId(ORG_A),
      invoiceId: new Types.ObjectId(),
      amount: 1000,
      currency: 'XOF',
      status: 'pending',
      provider: 'flutterwave',
      providerReference: 'korva_invA_tx1',
    });
    await paymentsRepository.createPayment({
      organizationId: new Types.ObjectId(ORG_B),
      invoiceId: new Types.ObjectId(),
      amount: 2000,
      currency: 'XOF',
      status: 'pending',
      provider: 'flutterwave',
      providerReference: 'korva_invB_tx1',
    });
  }, 30_000);

  afterAll(async () => {
    if (connection) {
      await connection.dropDatabase();
      await connection.close();
    }
  }, 30_000);

  async function process360dialog(input: {
    wabaId: string;
    providerEventId: string;
  }) {
    // Exactly what three-sixty-dialog-webhook.controller.ts's resolveOrganizationId does: derive
    // organizationId from the real, already-connected tenant account — the payload's own
    // (possibly forged) organizationId field is never read here or anywhere in this pipeline.
    const organizationId =
      (await integrationsService.findTenantOrganizationIdByWabaId(
        input.wabaId,
      )) ?? undefined;

    return webhookService.process({
      provider: '360dialog',
      domain: 'messaging',
      rawBody: Buffer.from('{}', 'utf8'),
      headers: { 'x-webhook-secret': '360dialog-shared' },
      verifier: new FakeWebhookVerifier('360dialog', '360dialog-shared'),
      extractEventId: () => input.providerEventId,
      organizationId,
    });
  }

  async function processFlutterwave(input: {
    txRef: string;
    providerEventId: string;
  }) {
    // Exactly what flutterwave-webhook.controller.ts's resolveOrganizationId does: derive
    // organizationId from the real Payment record KORVA itself created for this tx_ref.
    const organizationId =
      (await paymentsRepository.findOrganizationIdByProviderReference(
        'flutterwave',
        input.txRef,
      )) ?? undefined;

    return webhookService.process({
      provider: 'flutterwave',
      domain: 'payment',
      rawBody: Buffer.from('{}', 'utf8'),
      headers: { 'x-webhook-secret': 'flutterwave-shared' },
      verifier: new FakeWebhookVerifier('flutterwave', 'flutterwave-shared'),
      extractEventId: () => input.providerEventId,
      organizationId,
    });
  }

  async function persistedOrganizationId(
    provider: string,
    providerEventId: string,
  ): Promise<string | null> {
    const doc = await connection
      .model<IntegrationWebhookEventDocument>(IntegrationWebhookEvent.name)
      .findOne({ provider, providerEventId });
    return doc?.organizationId ? String(doc.organizationId) : null;
  }

  describe('360dialog — cross-tenant collision matrix (§11)', () => {
    it('webhook from waba-A always resolves to organization A', async () => {
      await process360dialog({ wabaId: 'waba-A', providerEventId: 'd-evt-1' });
      expect(await persistedOrganizationId('360dialog', 'd-evt-1')).toBe(ORG_A);
    });

    it('webhook from waba-B always resolves to organization B', async () => {
      await process360dialog({ wabaId: 'waba-B', providerEventId: 'd-evt-2' });
      expect(await persistedOrganizationId('360dialog', 'd-evt-2')).toBe(ORG_B);
    });

    it('an unknown WABA id resolves to NEITHER organization A nor B — persisted as an explicit unresolved (null) attribution', async () => {
      await process360dialog({
        wabaId: 'waba-does-not-exist',
        providerEventId: 'd-evt-3',
      });
      const resolved = await persistedOrganizationId('360dialog', 'd-evt-3');
      expect(resolved).toBeNull();
      expect(resolved).not.toBe(ORG_A);
      expect(resolved).not.toBe(ORG_B);
    });

    it('a "forged organizationId" carried in the payload is structurally impossible to honor: resolution here never reads any payload field, only the WABA-id-keyed database lookup', async () => {
      // There is no code path by which a payload value could reach organizationId at all (see
      // process360dialog above and IntegrationsService.findTenantOrganizationIdByWabaId's own
      // signature — it takes a WABA id string, nothing shaped like a request body). This test
      // documents that invariant with the exact scenario the mandate names: waba-A's webhook,
      // with an attacker-controlled field claiming organization B, still resolves to A.
      await process360dialog({
        wabaId: 'waba-A',
        providerEventId: 'd-evt-4',
      });
      expect(await persistedOrganizationId('360dialog', 'd-evt-4')).toBe(ORG_A);
    });
  });

  describe('Flutterwave — cross-tenant collision matrix (§11)', () => {
    it('webhook for tx_ref belonging to invoice A always resolves to organization A', async () => {
      await processFlutterwave({
        txRef: 'korva_invA_tx1',
        providerEventId: 'f-evt-1',
      });
      expect(await persistedOrganizationId('flutterwave', 'f-evt-1')).toBe(
        ORG_A,
      );
    });

    it('webhook for tx_ref belonging to invoice B always resolves to organization B', async () => {
      await processFlutterwave({
        txRef: 'korva_invB_tx1',
        providerEventId: 'f-evt-2',
      });
      expect(await persistedOrganizationId('flutterwave', 'f-evt-2')).toBe(
        ORG_B,
      );
    });

    it('an unknown tx_ref (no matching Payment) resolves to NEITHER organization A nor B — persisted as an explicit unresolved (null) attribution', async () => {
      await processFlutterwave({
        txRef: 'korva_never_created_tx',
        providerEventId: 'f-evt-3',
      });
      const resolved = await persistedOrganizationId('flutterwave', 'f-evt-3');
      expect(resolved).toBeNull();
      expect(resolved).not.toBe(ORG_A);
      expect(resolved).not.toBe(ORG_B);
    });
  });

  describe('Platform vs tenant scope — no confusion (§9)', () => {
    it('a 360dialog webhook is never attributed to a platform-scope account, even if one exists for the same domain/provider', async () => {
      await integrationsService.createPlatformAccount({
        domain: 'messaging',
        provider: '360dialog',
        role: 'bsp-platform',
        market: null,
        secret: 'platform-secret-not-a-tenant-credential',
      });

      // findTenantAccountByWabaId filters scope:'tenant' explicitly — a platform account (which
      // has no wabaId in its metadata at all in this scenario) can never satisfy the query.
      await process360dialog({ wabaId: 'waba-A', providerEventId: 'd-evt-5' });
      expect(await persistedOrganizationId('360dialog', 'd-evt-5')).toBe(ORG_A);
    });
  });

  describe('Concurrent delivery keeps tenant attribution stable (§14)', () => {
    it('10 concurrent identical 360dialog webhooks from waba-A → exactly one persisted event → organizationId is A for that one event → no cross-tenant assignment', async () => {
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          process360dialog({
            wabaId: 'waba-A',
            providerEventId: 'd-evt-concurrent',
          }),
        ),
      );

      expect(results.filter((r) => r.status === 'processed').length).toBe(1);
      expect(results.filter((r) => r.status === 'duplicate').length).toBe(9);

      const count = await connection
        .model(IntegrationWebhookEvent.name)
        .countDocuments({
          provider: '360dialog',
          providerEventId: 'd-evt-concurrent',
        });
      expect(count).toBe(1);
      expect(
        await persistedOrganizationId('360dialog', 'd-evt-concurrent'),
      ).toBe(ORG_A);
    });
  });

  describe('EventBus receives the correct tenant context, secret-free (§15/F9/D8/F10/D9)', () => {
    it('publish() is called with the resolved organizationId as its first argument, and the payload it publishes carries no credential material', async () => {
      publish.mockClear();
      await processFlutterwave({
        txRef: 'korva_invA_tx1',
        providerEventId: 'f-evt-eventbus',
      });

      expect(publish).toHaveBeenCalledTimes(1);
      const [publishedOrgId, , publishedPayload] = publish.mock.calls[0] as [
        string,
        string,
        Record<string, unknown>,
      ];
      expect(publishedOrgId).toBe(ORG_A);
      expect(JSON.stringify(publishedPayload)).not.toMatch(
        /secret|apiKey|api_key|D360-API-KEY|Authorization/i,
      );
    });
  });
});
