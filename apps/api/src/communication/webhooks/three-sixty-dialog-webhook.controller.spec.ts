import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ThreeSixtyDialogWebhookController,
  extractThreeSixtyDialogEventId,
} from './three-sixty-dialog-webhook.controller';
import type {
  IntegrationWebhookService,
  ProcessWebhookInput,
  ProcessWebhookResult,
} from '../../integrations/webhooks/integration-webhook.service';

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
    controller = new ThreeSixtyDialogWebhookController(
      configService as unknown as ConfigService,
      webhookService as unknown as IntegrationWebhookService,
    );
  });

  function makeRequest(body: string) {
    return { rawBody: Buffer.from(body, 'utf8'), headers: {} } as never;
  }

  function statusPayload() {
    return JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba1',
          changes: [
            {
              field: 'messages',
              value: {
                statuses: [{ id: 'wamid.STATUS1', status: 'delivered' }],
              },
            },
          ],
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
});
