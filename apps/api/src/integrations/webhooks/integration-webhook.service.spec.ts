import { Test } from '@nestjs/testing';
import { EventBusService } from '../../core/events/event-bus.service';
import { IntegrationWebhookRepository } from './integration-webhook.repository';
import { IntegrationWebhookService } from './integration-webhook.service';
import { FakeWebhookVerifier } from './fake-webhook-verifier';
import type { WebhookVerifier } from './webhook-verifier.interface';

describe('IntegrationWebhookService', () => {
  let service: IntegrationWebhookService;
  let repository: jest.Mocked<Pick<IntegrationWebhookRepository, 'claimIfNew'>>;
  let eventBus: jest.Mocked<Pick<EventBusService, 'publish'>>;

  const extractEventId = (payload: Record<string, unknown>): string =>
    String(payload.id);

  beforeEach(async () => {
    repository = { claimIfNew: jest.fn() };
    eventBus = { publish: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        IntegrationWebhookService,
        { provide: IntegrationWebhookRepository, useValue: repository },
        { provide: EventBusService, useValue: eventBus },
      ],
    }).compile();

    service = moduleRef.get(IntegrationWebhookService);
  });

  // `verifySpy` is returned as a standalone value (rather than asserted on via `verifier.verify`
  // later) — same pattern already used by password-reset.service.spec.ts for an interface-typed
  // mock, which avoids a false-positive @typescript-eslint/unbound-method.
  function makeVerifier(result: boolean): {
    verifier: WebhookVerifier;
    verifySpy: jest.Mock;
  } {
    const verifySpy = jest.fn().mockReturnValue(result);
    return {
      verifier: { provider: 'fake-provider', verify: verifySpy },
      verifySpy,
    };
  }

  it('TEST 1 — an invalid signature is rejected: nothing persisted, nothing published', async () => {
    const { verifier, verifySpy } = makeVerifier(false);
    const rawBody = Buffer.from(JSON.stringify({ id: 'evt-1' }), 'utf8');

    const result = await service.process({
      provider: 'flutterwave',
      domain: 'payment',
      rawBody,
      headers: { 'x-webhook-secret': 'wrong' },
      verifier,
      extractEventId,
    });

    expect(result).toEqual({ status: 'invalid_signature' });
    expect(verifySpy).toHaveBeenCalledWith(rawBody, {
      'x-webhook-secret': 'wrong',
    });
    expect(repository.claimIfNew).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('TEST 2 — a first delivery is verified, persisted, and published exactly once', async () => {
    const { verifier } = makeVerifier(true);
    repository.claimIfNew.mockResolvedValue({
      inserted: true,
      event: null as never,
    });
    const rawBody = Buffer.from(JSON.stringify({ id: 'evt-first' }), 'utf8');

    const result = await service.process({
      provider: 'flutterwave',
      domain: 'payment',
      rawBody,
      headers: {},
      verifier,
      extractEventId,
    });

    expect(result).toEqual({ status: 'processed' });
    expect(repository.claimIfNew).toHaveBeenCalledWith({
      provider: 'flutterwave',
      providerEventId: 'evt-first',
      domain: 'payment',
      payload: { id: 'evt-first' },
      organizationId: null,
    });
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
    expect(eventBus.publish).toHaveBeenCalledWith(
      'unresolved',
      'payment.webhook_received',
      expect.objectContaining({
        provider: 'flutterwave',
        domain: 'payment',
        providerEventId: 'evt-first',
        paymentId: 'evt-first',
      }),
    );
  });

  it('TEST 3 — messaging domain publishes whatsapp.status_updated with a messageId field', async () => {
    const { verifier } = makeVerifier(true);
    repository.claimIfNew.mockResolvedValue({
      inserted: true,
      event: null as never,
    });
    const rawBody = Buffer.from(JSON.stringify({ id: 'evt-msg-1' }), 'utf8');

    const result = await service.process({
      provider: '360dialog',
      domain: 'messaging',
      rawBody,
      headers: {},
      verifier,
      extractEventId,
      organizationId: 'org-123',
    });

    expect(result).toEqual({ status: 'processed' });
    expect(eventBus.publish).toHaveBeenCalledWith(
      'org-123',
      'whatsapp.status_updated',
      expect.objectContaining({ messageId: 'evt-msg-1' }),
    );
  });

  it('TEST 3b (Stage 2.5) — a resolved organizationId is persisted onto the claimed IntegrationWebhookEvent, not just threaded into EventBus', async () => {
    const { verifier } = makeVerifier(true);
    repository.claimIfNew.mockResolvedValue({
      inserted: true,
      event: null as never,
    });
    const rawBody = Buffer.from(JSON.stringify({ id: 'evt-msg-2' }), 'utf8');

    await service.process({
      provider: '360dialog',
      domain: 'messaging',
      rawBody,
      headers: {},
      verifier,
      extractEventId,
      organizationId: 'org-456',
    });

    expect(repository.claimIfNew).toHaveBeenCalledWith({
      provider: '360dialog',
      providerEventId: 'evt-msg-2',
      domain: 'messaging',
      payload: { id: 'evt-msg-2' },
      organizationId: 'org-456',
    });
  });

  it('TEST 2b (Stage 2.5, F9) — payment domain: a resolved organizationId reaches EventBus.publish exactly as resolved, never the unresolved sentinel', async () => {
    const { verifier } = makeVerifier(true);
    repository.claimIfNew.mockResolvedValue({
      inserted: true,
      event: null as never,
    });
    const rawBody = Buffer.from(JSON.stringify({ id: 'evt-pay-1' }), 'utf8');

    await service.process({
      provider: 'flutterwave',
      domain: 'payment',
      rawBody,
      headers: {},
      verifier,
      extractEventId,
      organizationId: 'org-flw-A',
    });

    expect(eventBus.publish).toHaveBeenCalledWith(
      'org-flw-A',
      'payment.webhook_received',
      expect.objectContaining({ paymentId: 'evt-pay-1' }),
    );
  });

  /**
   * THE critical proof test — per the owner's explicit idempotency requirement: duplicate
   * delivery of the identical webhook event must return 'duplicate' and must NEVER cause a
   * second EventBusService.publish() call. Simulates two deliveries end to end (not just calling
   * claimIfNew twice) by having the mocked repository behave exactly like the real one would:
   * `inserted: true` the first time, `inserted: false` every time after, for the same
   * (provider, providerEventId).
   */
  it('TEST 4 — DUPLICATE delivery of the identical event returns "duplicate" and publishes exactly once total across both deliveries', async () => {
    const { verifier } = makeVerifier(true);
    const claimed = new Set<string>();
    repository.claimIfNew.mockImplementation((input) => {
      const key = `${input.provider}:${input.providerEventId}`;
      if (claimed.has(key)) {
        return Promise.resolve({ inserted: false, event: null });
      }
      claimed.add(key);
      return Promise.resolve({ inserted: true, event: null as never });
    });

    const rawBody = Buffer.from(JSON.stringify({ id: 'evt-dup' }), 'utf8');
    const input = {
      provider: 'flutterwave',
      domain: 'payment' as const,
      rawBody,
      headers: {},
      verifier,
      extractEventId,
    };

    const first = await service.process(input);
    const second = await service.process(input);

    expect(first).toEqual({ status: 'processed' });
    expect(second).toEqual({ status: 'duplicate' });
    expect(repository.claimIfNew).toHaveBeenCalledTimes(2);
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
  });

  it('TEST 5 — end-to-end against the real (non-mocked) FakeWebhookVerifier: correct shared secret is accepted', async () => {
    repository.claimIfNew.mockResolvedValue({
      inserted: true,
      event: null as never,
    });
    const verifier = new FakeWebhookVerifier('flutterwave', 'shhh-secret');
    const rawBody = Buffer.from(
      JSON.stringify({ id: 'evt-real-verifier' }),
      'utf8',
    );

    const result = await service.process({
      provider: 'flutterwave',
      domain: 'payment',
      rawBody,
      headers: { 'x-webhook-secret': 'shhh-secret' },
      verifier,
      extractEventId,
    });

    expect(result).toEqual({ status: 'processed' });
  });

  it('TEST 6 — end-to-end against the real FakeWebhookVerifier: wrong shared secret is rejected, nothing persisted', async () => {
    const verifier = new FakeWebhookVerifier('flutterwave', 'shhh-secret');
    const rawBody = Buffer.from(
      JSON.stringify({ id: 'evt-real-verifier-2' }),
      'utf8',
    );

    const result = await service.process({
      provider: 'flutterwave',
      domain: 'payment',
      rawBody,
      headers: { 'x-webhook-secret': 'nope' },
      verifier,
      extractEventId,
    });

    expect(result).toEqual({ status: 'invalid_signature' });
    expect(repository.claimIfNew).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('TEST 7 — the structured log line carries only the mandated fields, never the raw payload/headers', async () => {
    const logSpy = jest
      .spyOn(
        (service as unknown as { logger: { log: jest.Mock } }).logger,
        'log',
      )
      .mockImplementation(() => undefined);
    const { verifier } = makeVerifier(true);
    repository.claimIfNew.mockResolvedValue({
      inserted: true,
      event: null as never,
    });

    await service.process({
      provider: 'flutterwave',
      domain: 'payment',
      rawBody: Buffer.from(
        JSON.stringify({ id: 'evt-log', secret: 'do-not-log-me' }),
        'utf8',
      ),
      headers: { 'x-secret-header': 'do-not-log-me-either' },
      verifier,
      extractEventId,
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const loggedArg = logSpy.mock.calls[0]?.[0] as
      Record<string, unknown> | undefined;
    expect(loggedArg).toMatchObject({
      integration: 'webhook',
      provider: 'flutterwave',
      organizationId: null,
      eventType: 'payment.webhook_received',
      eventId: 'evt-log',
      status: 'processed',
    });
    expect(typeof loggedArg?.durationMs).toBe('number');
    expect(Object.keys(loggedArg ?? {}).sort()).toEqual([
      'durationMs',
      'eventId',
      'eventType',
      'integration',
      'organizationId',
      'provider',
      'status',
    ]);
    expect(JSON.stringify(loggedArg)).not.toContain('do-not-log-me');
  });
});
