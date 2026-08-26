import {
  BadRequestException,
  Controller,
  HttpCode,
  Logger,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import { IntegrationWebhookService } from '../../../integrations/webhooks/integration-webhook.service';
import { FlutterwaveWebhookVerifier } from './flutterwave-webhook-verifier';

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

/** Same shape/reasoning as RESEND_WEBHOOK_THROTTLE in resend-webhook.controller.ts. */
const FLUTTERWAVE_WEBHOOK_THROTTLE = { default: { limit: 60, ttl: 60_000 } };

/**
 * Receives Flutterwave's async payment-status webhooks and hands them to the generic, already-
 * tested Stage 1 pipeline (`IntegrationWebhookService.process`) — this controller does its own
 * job (fail-closed config check, raw-body/signature verification, HTTP status mapping) and
 * nothing else; it never touches persistence/idempotency/publish directly, mirroring
 * resend-webhook.controller.ts's own division of labor with resend-webhook.service.ts.
 *
 * Public by necessity (Flutterwave calls it, not an authenticated KORVA user); the ONLY trust
 * boundary is `FlutterwaveWebhookVerifier`'s `verif-hash` check below — there is no tenant/JWT
 * context on this route at all, exactly like the Resend webhook route.
 *
 * Requires the exact raw request bytes Flutterwave sent (`req.rawBody`, populated by
 * `NestFactory.create(AppModule, { rawBody: true })` in main.ts's bootstrap()) — even though
 * `FlutterwaveWebhookVerifier`'s own check doesn't hash the body (see its doc comment), the raw
 * bytes are still what `IntegrationWebhookService.process` JSON.parses after a successful verify,
 * so the same defense-in-depth "fail closed with 503 if raw body is unavailable" guard from the
 * Resend controller applies here too.
 */
@Public()
@Controller('webhooks/flutterwave')
export class FlutterwaveWebhookController {
  private readonly logger = new Logger(FlutterwaveWebhookController.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly integrationWebhookService: IntegrationWebhookService,
  ) {}

  @Throttle(FLUTTERWAVE_WEBHOOK_THROTTLE)
  @Post()
  @HttpCode(200)
  async handle(@Req() req: RequestWithRawBody): Promise<{ received: boolean }> {
    const secretHash = this.configService.get<string>(
      'FLUTTERWAVE_WEBHOOK_SECRET_HASH',
    );
    if (!secretHash) {
      this.logger.error(
        'FLUTTERWAVE_WEBHOOK_SECRET_HASH is not configured; rejecting an incoming Flutterwave webhook call',
      );
      throw new ServiceUnavailableException({
        code: 'FLUTTERWAVE_WEBHOOK_NOT_CONFIGURED',
        message: 'Flutterwave webhook receiver is not configured',
      });
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      this.logger.error(
        'req.rawBody is unavailable — see this controller’s class-level comment: NestFactory.create needs { rawBody: true } for Flutterwave webhook processing to work end-to-end',
      );
      throw new ServiceUnavailableException({
        code: 'FLUTTERWAVE_WEBHOOK_RAW_BODY_UNAVAILABLE',
        message:
          'Flutterwave webhook receiver cannot process events in this deployment yet',
      });
    }

    const verifier = new FlutterwaveWebhookVerifier(secretHash);

    let result: Awaited<ReturnType<IntegrationWebhookService['process']>>;
    try {
      result = await this.integrationWebhookService.process({
        provider: 'flutterwave',
        domain: 'payment',
        rawBody,
        headers: req.headers,
        verifier,
        extractEventId: (payload) => this.extractEventId(payload),
      });
    } catch (error) {
      // Per IntegrationWebhookService.process's own doc comment: a thrown error from
      // extractEventId (or a malformed-JSON body, thrown internally by that same method before
      // extractEventId ever runs) has no HTTP context of its own — mapping it to a 400 is
      // explicitly this controller's job, exactly like resend-webhook.controller.ts's own
      // INVALID_JSON handling for its pipeline.
      throw new BadRequestException({
        code: 'INVALID_WEBHOOK_PAYLOAD',
        message:
          error instanceof Error
            ? error.message
            : 'Malformed Flutterwave webhook payload',
      });
    }

    if (result.status === 'invalid_signature') {
      throw new UnauthorizedException({
        code: 'INVALID_WEBHOOK_SIGNATURE',
        message: 'Invalid webhook signature',
      });
    }

    return { received: true };
  }

  /**
   * Flutterwave payment-domain webhook payloads carry the event's own transaction reference at
   * `data.id` (Flutterwave's numeric transaction id) per every payload sample in
   * developer.flutterwave.com/v3.0.0/docs/webhooks.md (fetched 2026-08-26); falls back to
   * `data.tx_ref` (the merchant reference this adapter generates in
   * flutterwave-payment.provider.ts's `createPayment`) if `id` is absent, since not every
   * documented event carries both. Throws if neither is present.
   */
  private extractEventId(payload: Record<string, unknown>): string {
    const data =
      typeof payload.data === 'object' && payload.data !== null
        ? (payload.data as Record<string, unknown>)
        : undefined;

    const id = data?.id;
    if (typeof id === 'string' && id.length > 0) {
      return id;
    }
    if (typeof id === 'number') {
      return String(id);
    }

    const txRef = data?.tx_ref;
    if (typeof txRef === 'string' && txRef.length > 0) {
      return txRef;
    }

    throw new Error(
      'Flutterwave webhook payload is missing both data.id and data.tx_ref',
    );
  }
}
