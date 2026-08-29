import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import {
  ThreeSixtyDialogWebhookController,
  extractThreeSixtyDialogEventId,
  extractThreeSixtyDialogAccountId,
} from './three-sixty-dialog-webhook.controller';
import type {
  IntegrationWebhookService,
  ProcessWebhookInput,
  ProcessWebhookResult,
} from '../../integrations/webhooks/integration-webhook.service';
import type { IntegrationsService } from '../../integrations/integrations.service';

describe('ThreeSixtyDialogWebhookController', () => {
  const secret = 'platform-secret-abc';
  const verifyToken = 'verify-token-xyz';
  let controller: ThreeSixtyDialogWebhookController;
  let configService: {
    get: jest.Mock<string | undefined, [string]>;
  };
  let webhookService: {
    process: jest.Mock<Promise<ProcessWebhookResult>, [ProcessWebhookInput]>;
  };
  let integrationsService: {
    findTenantOrganizationIdByWabaId: jest.Mock;
  };

  beforeEach(() => {
    configService = {
      get: jest
        .fn<string | undefined, [string]>()
        .mockImplementation((key: string) => {
          if (key === 'THREESIXTYDIALOG_WEBHOOK_SECRET') return secret;
          if (key === 'THREESIXTYDIALOG_WEBHOOK_VERIFY_TOKEN')
            return verifyToken;
          return undefined;
        }),
    };
    webhookService = {
      process: jest
        .fn<Promise<ProcessWebhookResult>, [ProcessWebhookInput]>()
        .mockResolvedValue({ status: 'processed' }),
    };
    // Unresolved by default — individual tests (D1/D2/D3/D4) override this to prove real
    // attribution/isolation behavior.
    integrationsService = {
      findTenantOrganizationIdByWabaId: jest.fn().mockResolvedValue(null),
    };
    controller = new ThreeSixtyDialogWebhookController(
      configService as unknown as ConfigService,
      webhookService as unknown as IntegrationWebhookService,
      integrationsService as unknown as IntegrationsService,
    );
  });

  /** Signs `body` with the same HMAC-SHA256 scheme ThreeSixtyDialogWebhookVerifier expects, so
   *  tests that need `verifier.verify()` to actually return true (Stage 2.5's own
   *  resolveOrganizationId call, made directly by the controller) don't have to fake it. */
  function sign(body: string): string {
    return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  }

  function makeRequest(body: string, signed = true) {
    return {
      rawBody: Buffer.from(body, 'utf8'),
      headers: signed ? { 'x-360dialog-signature': sign(body) } : {},
    } as never;
  }

  function statusPayload(
    wabaId = 'waba1',
    extra: Record<string, unknown> = {},
  ) {
    return JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: wabaId,
          changes: [
            {
              field: 'messages',
              value: {
                statuses: [{ id: 'wamid.STATUS1', status: 'delivered' }],
              },
            },
          ],
          ...extra,
        },
      ],
    });
  }

  describe('POST handle', () => {
    it('TEST 1 — rejects with 503 when THREESIXTYDIALOG_WEBHOOK_SECRET is not configured', async () => {
      configService.get.mockReturnValue(undefined);

      await expect(controller.handle(makeRequest('{}'))).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(webhookService.process).not.toHaveBeenCalled();
    });

    it('TEST 2 — rejects with 503 when req.rawBody is unavailable', async () => {
      await expect(
        controller.handle({ headers: {} } as never),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(webhookService.process).not.toHaveBeenCalled();
    });

    it('TEST 3 — rejects with 401 when IntegrationWebhookService reports invalid_signature', async () => {
      webhookService.process.mockResolvedValue({ status: 'invalid_signature' });

      await expect(
        controller.handle(makeRequest(statusPayload())),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('TEST 4 — calls IntegrationWebhookService.process exactly once with provider/domain/verifier and returns {received:true} on success', async () => {
      const body = statusPayload();
      const result = await controller.handle(makeRequest(body));

      expect(result).toEqual({ received: true });
      expect(webhookService.process).toHaveBeenCalledTimes(1);
      const call = webhookService.process.mock.calls[0]![0];
      expect(call.provider).toBe('360dialog');
      expect(call.domain).toBe('messaging');
      expect(call.rawBody).toEqual(Buffer.from(body, 'utf8'));
      expect(call.verifier.provider).toBe('360dialog');
      expect(typeof call.extractEventId).toBe('function');
      expect(
        call.extractEventId(JSON.parse(body) as Record<string, unknown>),
      ).toBe('wamid.STATUS1');
    });

    it('TEST 5 — returns {received:true} (ack) on a duplicate delivery, without erroring', async () => {
      webhookService.process.mockResolvedValue({ status: 'duplicate' });

      const result = await controller.handle(makeRequest(statusPayload()));

      expect(result).toEqual({ received: true });
    });

    it('TEST 6 — rejects with 400 when the extractEventId contract throws for an unrecognized payload (via the real service in effect)', async () => {
      // Simulate what process() does: propagate a thrown error from extractEventId/JSON.parse.
      webhookService.process.mockRejectedValue(
        new Error(
          '360dialog webhook payload has neither statuses[0].id nor messages[0].id',
        ),
      );

      await expect(
        controller.handle(makeRequest('{"entry":[]}')),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('extractThreeSixtyDialogEventId', () => {
    it('extracts a status event id from value.statuses[0].id', () => {
      const payload = JSON.parse(statusPayload()) as Record<string, unknown>;
      expect(extractThreeSixtyDialogEventId(payload)).toBe('wamid.STATUS1');
    });

    it('extracts an inbound message event id from value.messages[0].id', () => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba1',
            changes: [
              {
                field: 'messages',
                value: { messages: [{ id: 'wamid.MSG1' }] },
              },
            ],
          },
        ],
      };
      expect(extractThreeSixtyDialogEventId(payload)).toBe('wamid.MSG1');
    });

    it('throws for a payload with neither statuses nor messages', () => {
      expect(() => extractThreeSixtyDialogEventId({ entry: [] })).toThrow();
    });
  });

  describe('GET verifyHandshake', () => {
    it('echoes hub.challenge back when hub.mode and hub.verify_token are correct', () => {
      const result = controller.verifyHandshake(
        'subscribe',
        verifyToken,
        'chal-123',
      );
      expect(result).toBe('chal-123');
    });

    it('rejects with 401 when hub.verify_token does not match', () => {
      expect(() =>
        controller.verifyHandshake('subscribe', 'wrong-token', 'chal-123'),
      ).toThrow(UnauthorizedException);
    });

    it('rejects with 401 when THREESIXTYDIALOG_WEBHOOK_VERIFY_TOKEN is not configured', () => {
      configService.get.mockReturnValue(undefined);
      expect(() =>
        controller.verifyHandshake('subscribe', verifyToken, 'chal-123'),
      ).toThrow(UnauthorizedException);
    });

    it('rejects with 401 when hub.mode is not "subscribe"', () => {
      expect(() =>
        controller.verifyHandshake('unsubscribe', verifyToken, 'chal-123'),
      ).toThrow(UnauthorizedException);
    });
  });

  describe('extractThreeSixtyDialogAccountId (Stage 2.5)', () => {
    it('extracts the WABA id from entry[0].id', () => {
      const payload = JSON.parse(statusPayload('waba-xyz')) as Record<
        string,
        unknown
      >;
      expect(extractThreeSixtyDialogAccountId(payload)).toBe('waba-xyz');
    });

    it('returns undefined (never throws) when entry is missing/empty', () => {
      expect(extractThreeSixtyDialogAccountId({ entry: [] })).toBeUndefined();
      expect(extractThreeSixtyDialogAccountId({})).toBeUndefined();
    });
  });

  describe('Stage 2.5 — webhook tenant attribution (D1–D9)', () => {
    it('D1 — a valid signed webhook resolves to the correct tenant via IntegrationsService, looked up by WABA id', async () => {
      integrationsService.findTenantOrganizationIdByWabaId.mockResolvedValue(
        'org-A',
      );

      await controller.handle(makeRequest(statusPayload('waba-A')));

      expect(
        integrationsService.findTenantOrganizationIdByWabaId,
      ).toHaveBeenCalledWith('waba-A');
      const call = webhookService.process.mock.calls[0]![0];
      expect(call.organizationId).toBe('org-A');
    });

    it('D2 — a valid signed webhook for an unknown WABA id is passed through with organizationId undefined (unresolved), never rejected outright', async () => {
      integrationsService.findTenantOrganizationIdByWabaId.mockResolvedValue(
        null,
      );

      await controller.handle(makeRequest(statusPayload('waba-unknown')));

      const call = webhookService.process.mock.calls[0]![0];
      expect(call.organizationId).toBeUndefined();
    });

    it('D3 — a forged organizationId field in the payload is completely ignored: attribution comes only from the WABA id lookup, never from the payload', async () => {
      integrationsService.findTenantOrganizationIdByWabaId.mockResolvedValue(
        'org-A',
      );

      await controller.handle(
        makeRequest(statusPayload('waba-A', { organizationId: 'org-FORGED' })),
      );

      const call = webhookService.process.mock.calls[0]![0];
      expect(call.organizationId).toBe('org-A');
    });

    it('D4 — tenant A / tenant B isolation: two deliveries with different WABA ids resolve to their own, distinct organizationId, never crossed', async () => {
      integrationsService.findTenantOrganizationIdByWabaId.mockImplementation(
        (wabaId: string) =>
          Promise.resolve(wabaId === 'waba-A' ? 'org-A' : 'org-B'),
      );

      await controller.handle(makeRequest(statusPayload('waba-A')));
      await controller.handle(makeRequest(statusPayload('waba-B')));

      const calls = webhookService.process.mock.calls;
      expect(calls[0]![0].organizationId).toBe('org-A');
      expect(calls[1]![0].organizationId).toBe('org-B');
    });

    it('D6 — an invalid HMAC signature never triggers tenant attribution: IntegrationsService is not even called', async () => {
      await controller.handle(makeRequest(statusPayload('waba-A'), false));

      expect(
        integrationsService.findTenantOrganizationIdByWabaId,
      ).not.toHaveBeenCalled();
    });
  });
});
