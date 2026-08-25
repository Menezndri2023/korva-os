import {
  BadRequestException,
  Controller,
  Headers,
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
import { Public } from '../../common/decorators/public.decorator';
import { verifySvixSignature } from './verify-svix-signature';
import { ResendWebhookService } from './resend-webhook.service';

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

/**
 * Generous relative to a real Resend account's volume, tight enough to blunt abuse of a public,
 * unauthenticated endpoint — mirrors the reasoning next to PUBLIC_BOOKING_THROTTLE in
 * public.controller.ts, just a higher ceiling since a legitimate account can burst many
 * delivery-status events at once.
 */
const RESEND_WEBHOOK_THROTTLE = { default: { limit: 60, ttl: 60_000 } };

/**
 * Receives Resend's async delivery-status webhooks (delivered/bounced/complained — see
 * resend-webhook.service.ts for the full event map) and updates the matching Message's status.
 * Public by necessity (Resend calls it, not an authenticated KORVA user); the ONLY trust boundary
 * is svix signature verification below — there is no tenant/JWT context on this route at all.
 *
 * Verifying a Svix signature requires the exact raw request bytes Resend sent, not a
 * re-serialization of `req.body` (unreliable — see verify-svix-signature.ts). `req.rawBody` is
 * populated by `NestFactory.create(AppModule, { rawBody: true })` in main.ts's bootstrap() (wired
 * up in Wave 2.1 — previously this endpoint failed closed with 503 because that option was
 * missing; the `!rawBody` branch below is now a defense-in-depth guard against that
 * misconfiguration recurring, not the expected steady-state path).
 */
@Public()
@Controller('webhooks/resend')
export class ResendWebhookController {
  private readonly logger = new Logger(ResendWebhookController.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly resendWebhookService: ResendWebhookService,
  ) {}

  @Throttle(RESEND_WEBHOOK_THROTTLE)
  @Post()
  @HttpCode(200)
  async handle(
    @Req() req: RequestWithRawBody,
    @Headers('svix-id') svixId?: string,
    @Headers('svix-timestamp') svixTimestamp?: string,
    @Headers('svix-signature') svixSignature?: string,
  ): Promise<{ received: boolean }> {
    const secret = this.configService.get<string>('RESEND_WEBHOOK_SECRET');
    if (!secret) {
      this.logger.error(
        'RESEND_WEBHOOK_SECRET is not configured; rejecting an incoming Resend webhook call',
      );
      throw new ServiceUnavailableException({
        code: 'RESEND_WEBHOOK_NOT_CONFIGURED',
        message: 'Resend webhook receiver is not configured',
      });
    }

    if (!svixId || !svixTimestamp || !svixSignature) {
      throw new BadRequestException({
        code: 'MISSING_SIGNATURE_HEADERS',
        message: 'Missing svix-id/svix-timestamp/svix-signature headers',
      });
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      this.logger.error(
        'req.rawBody is unavailable — see this controller’s class-level comment: NestFactory.create needs { rawBody: true } for Resend webhook signature verification to work end-to-end',
      );
      throw new ServiceUnavailableException({
        code: 'RESEND_WEBHOOK_RAW_BODY_UNAVAILABLE',
        message:
          'Resend webhook receiver cannot verify signatures in this deployment yet',
      });
    }

    const verified = verifySvixSignature(
      rawBody,
      { svixId, svixTimestamp, svixSignature },
      secret,
    );
    if (!verified) {
      throw new UnauthorizedException({
        code: 'INVALID_WEBHOOK_SIGNATURE',
        message: 'Invalid webhook signature',
      });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException({
        code: 'INVALID_JSON',
        message: 'Malformed JSON payload',
      });
    }

    await this.resendWebhookService.handleEvent(payload);
    return { received: true };
  }
}
