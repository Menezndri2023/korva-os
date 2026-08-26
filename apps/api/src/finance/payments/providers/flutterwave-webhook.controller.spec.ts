import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FlutterwaveWebhookController } from './flutterwave-webhook.controller';
import { IntegrationWebhookService } from '../../../integrations/webhooks/integration-webhook.service';

interface CapturedProcessCall {
  provider: string;
  domain: string;
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  verifier: { provider: string };
  extractEventId: (payload: Record<string, unknown>) => string;
}

describe('FlutterwaveWebhookController', () => {
  const secretHash = 'a-very-secret-hash-value';
  let controller: FlutterwaveWebhookController;
  let configService: { get: jest.Mock };
  let webhookService: { process: jest.Mock };

  beforeEach(() => {
    configService = { get: jest.fn().mockReturnValue(secretHash) };
    webhookService = {
      process: jest.fn().mockResolvedValue({ status: 'processed' }),
    };
    controller = new FlutterwaveWebhookController(
      configService as unknown as ConfigService,
      webhookService as unknown as IntegrationWebhookService,
    );
  });

  function makeRequest(
    body: string,
    headers: Record<string, string | string[] | undefined> = {},
  ) {
    return {
      rawBody: Buffer.from(body, 'utf8'),
      headers: { 'verif-hash': secretHash, ...headers },
    } as never;
  }

  it('TEST 1 — fail-closed: rejects with 503 when FLUTTERWAVE_WEBHOOK_SECRET_HASH is not configured', async () => {
    configService.get.mockReturnValue(undefined);

    await expect(controller.handle(makeRequest('{}'))).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(webhookService.process).not.toHaveBeenCalled();
  });

  it('TEST 2 — fail-closed: rejects with 503 when req.rawBody is unavailable', async () => {
    await expect(
      controller.handle({ headers: {} } as never),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(webhookService.process).not.toHaveBeenCalled();
  });

  it('TEST 3 — 401 on bad signature: when the pipeline reports invalid_signature, throws UnauthorizedException', async () => {
    webhookService.process.mockResolvedValue({ status: 'invalid_signature' });

    await expect(
      controller.handle(makeRequest('{}', { 'verif-hash': 'wrong-hash' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('TEST 4 — success: calls IntegrationWebhookService.process exactly once with the expected shape and returns { received: true }', async () => {
    const body = JSON.stringify({
      event: 'charge.completed',
      data: { id: 285959875, tx_ref: 'korva_inv_1_abc', status: 'successful' },
    });

    const result = await controller.handle(makeRequest(body));

    expect(result).toEqual({ received: true });
    expect(webhookService.process).toHaveBeenCalledTimes(1);
    const calls = webhookService.process.mock
      .calls as unknown as CapturedProcessCall[][];
    const call = calls[0]![0]!;
    expect(call.provider).toBe('flutterwave');
    expect(call.domain).toBe('payment');
    expect(call.rawBody).toBeInstanceOf(Buffer);
    expect(call.headers['verif-hash']).toBe(secretHash);
    expect(typeof call.extractEventId).toBe('function');
    expect(call.verifier.provider).toBe('flutterwave');
  });

  it('TEST 5 — duplicate delivery: still returns { received: true } (idempotency is the pipeline’s job, not the controller’s)', async () => {
    webhookService.process.mockResolvedValue({ status: 'duplicate' });

    const result = await controller.handle(makeRequest('{}'));

    expect(result).toEqual({ received: true });
  });

  it('TEST 6 — a thrown error from the pipeline (e.g. malformed payload / extractEventId failure) is mapped to 400, not left as 500', async () => {
    webhookService.process.mockRejectedValue(
      new Error(
        'Flutterwave webhook payload is missing both data.id and data.tx_ref',
      ),
    );

    await expect(controller.handle(makeRequest('{}'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  describe('extractEventId (exercised indirectly via the extractEventId function passed to process())', () => {
    async function getExtractEventId(): Promise<
      (payload: Record<string, unknown>) => string
    > {
      await controller.handle(makeRequest('{}'));
      const calls = webhookService.process.mock
        .calls as unknown as CapturedProcessCall[][];
      return calls[0]![0]!.extractEventId;
    }

    it('uses data.id when present', async () => {
      const extractEventId = await getExtractEventId();
      expect(extractEventId({ data: { id: 12345, tx_ref: 'ref_1' } })).toBe(
        '12345',
      );
    });

    it('falls back to data.tx_ref when data.id is absent', async () => {
      const extractEventId = await getExtractEventId();
      expect(extractEventId({ data: { tx_ref: 'ref_1' } })).toBe('ref_1');
    });

    it('throws when neither data.id nor data.tx_ref is present', async () => {
      const extractEventId = await getExtractEventId();
      expect(() => extractEventId({ data: {} })).toThrow(
        /missing both data.id and data.tx_ref/,
      );
    });
  });
});
