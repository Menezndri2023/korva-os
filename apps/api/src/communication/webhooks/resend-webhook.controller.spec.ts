import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { ResendWebhookController } from './resend-webhook.controller';
import { ResendWebhookService } from './resend-webhook.service';

function sign(
  secret: string,
  svixId: string,
  svixTimestamp: string,
  payload: string,
): string {
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const digest = createHmac('sha256', secretBytes)
    .update(`${svixId}.${svixTimestamp}.${payload}`, 'utf8')
    .digest('base64');
  return `v1,${digest}`;
}

describe('ResendWebhookController', () => {
  const secret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
  let controller: ResendWebhookController;
  let configService: { get: jest.Mock };
  let webhookService: { handleEvent: jest.Mock };

  beforeEach(() => {
    configService = { get: jest.fn().mockReturnValue(secret) };
    webhookService = {
      handleEvent: jest.fn().mockResolvedValue({ handled: true }),
    };
    controller = new ResendWebhookController(
      configService as unknown as ConfigService,
      webhookService as unknown as ResendWebhookService,
    );
  });

  function makeRequest(body: string) {
    return { rawBody: Buffer.from(body, 'utf8') } as never;
  }

  it('TEST 1 — rejects with 503 when RESEND_WEBHOOK_SECRET is not configured', async () => {
    configService.get.mockReturnValue(undefined);

    await expect(
      controller.handle(makeRequest('{}'), 'id', '123', 'v1,sig'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('TEST 2 — rejects with 400 when any svix header is missing', async () => {
    await expect(
      controller.handle(makeRequest('{}'), undefined, '123', 'v1,sig'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.handle(makeRequest('{}'), 'id', undefined, 'v1,sig'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.handle(makeRequest('{}'), 'id', '123', undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('TEST 3 — rejects with 503 when req.rawBody is unavailable (documented raw-body limitation)', async () => {
    await expect(
      controller.handle({} as never, 'id', '123', 'v1,sig'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('TEST 4 — rejects with 401 on an incorrectly-signed payload', async () => {
    const body = JSON.stringify({
      type: 'email.delivered',
      data: { email_id: 'abc' },
    });
    await expect(
      controller.handle(
        makeRequest(body),
        'id',
        '123',
        'v1,not-the-real-signature',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(webhookService.handleEvent).not.toHaveBeenCalled();
  });

  it('TEST 5 — accepts a correctly-signed payload and forwards the parsed event to the service', async () => {
    const svixId = 'msg_1';
    const svixTimestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({
      type: 'email.delivered',
      data: { email_id: 'abc-123' },
    });
    const svixSignature = sign(secret, svixId, svixTimestamp, body);

    const result = await controller.handle(
      makeRequest(body),
      svixId,
      svixTimestamp,
      svixSignature,
    );

    expect(result).toEqual({ received: true });
    expect(webhookService.handleEvent).toHaveBeenCalledWith({
      type: 'email.delivered',
      data: { email_id: 'abc-123' },
    });
  });

  it('TEST 6 — a correctly-signed but non-JSON body is rejected with 400, not passed to the service', async () => {
    const svixId = 'msg_2';
    const svixTimestamp = String(Math.floor(Date.now() / 1000));
    const body = 'not json at all';
    const svixSignature = sign(secret, svixId, svixTimestamp, body);

    await expect(
      controller.handle(
        makeRequest(body),
        svixId,
        svixTimestamp,
        svixSignature,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(webhookService.handleEvent).not.toHaveBeenCalled();
  });
});
