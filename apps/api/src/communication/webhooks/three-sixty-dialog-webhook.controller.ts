import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { IntegrationWebhookService } from '../../integrations/webhooks/integration-webhook.service';
import type { ProcessWebhookResult } from '../../integrations/webhooks/integration-webhook.service';
import { ThreeSixtyDialogWebhookVerifier } from './three-sixty-dialog-webhook-verifier';

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

/**
 * Same reasoning as RESEND_WEBHOOK_THROTTLE next to ResendWebhookController: generous relative to
 * real per-tenant WhatsApp volume (docs/architecture/integrations-platform.md decision #5 —
 * "low/medium initial WhatsApp volume"), tight enough to blunt abuse of a public, unauthenticated
 * endpoint.
 */
const THREE_SIXTY_DIALOG_WEBHOOK_THROTTLE = {
  default: { limit: 60, ttl: 60_000 },
};

interface ThreeSixtyDialogWebhookPayload {
  entry?: Array<{
    id?: string;
    changes?: Array<{
      value?: {
        statuses?: Array<{ id?: string }>;
        messages?: Array<{ id?: string }>;
      };
    }>;
  }>;
}

/**
 * Pulls this delivery's own event id out of the (already signature-verified, already JSON-parsed)
 * payload, per `IntegrationWebhookService.process()`'s `extractEventId` contract. 360dialog's
 * webhook payload is Meta's native WhatsApp Cloud API shape passed through as-is
 * (`{ object: 'whatsapp_business_account', entry: [{ id, changes: [{ value, field }] }] }` —
 * confirmed against https://docs.360dialog.com/docs/messaging/webhook/webhook-reference.md):
 * a delivery-status event carries `value.statuses[0].id` (the WhatsApp message id the status is
 * about), an inbound-message event carries `value.messages[0].id` (the inbound message's own id).
 * Neither present means a payload shape this adapter doesn't recognize — thrown here, caught by
 * the controller and mapped to 400, exactly like ResendWebhookController's own INVALID_JSON
 * handling (see integration-webhook.service.ts's own doc comment on this contract).
 */
export function extractThreeSixtyDialogEventId(
  payload: Record<string, unknown>,
): string {
  const typed = payload as ThreeSixtyDialogWebhookPayload;
  const value = typed.entry?.[0]?.changes?.[0]?.value;
  const eventId = value?.statuses?.[0]?.id ?? value?.messages?.[0]?.id;
  if (!eventId) {
    throw new Error(
      '360dialog webhook payload has neither statuses[0].id nor messages[0].id',
    );
  }
  return eventId;
}

/**
 * Receives 360dialog's webhook deliveries (message status updates sent/delivered/read/failed, and
 * inbound customer messages), verifies them via `ThreeSixtyDialogWebhookVerifier`'s
 * `x-360dialog-signature` HMAC (see that file's own doc comment for why this is NOT Meta's
 * `X-Hub-Signature-256`), then hands them to the generic Stage 1
 * `IntegrationWebhookService.process()` pipeline (verify → idempotency → publish) — structurally
 * mirrors `ResendWebhookController` exactly.
 *
 * Public by necessity: 360dialog calls this, not an authenticated KORVA user. The ONLY trust
 * boundary is the signature — there is no tenant/JWT context on this route at all, same as Resend.
 * Fails closed (503) if `THREESIXTYDIALOG_WEBHOOK_SECRET` is unconfigured or `req.rawBody` is
 * unavailable, 401 on a bad signature, 400 on a signature-valid-but-unrecognized payload shape.
 *
 * Also exposes `GET` for Meta's documented one-time webhook-registration handshake
 * (`hub.mode`/`hub.verify_token`/`hub.challenge` — re-verified current as of this lot against
 * https://developers.facebook.com/docs/graph-api/webhooks/getting-started). Included for
 * spec-completeness and as cheap defense-in-depth, but flagged honestly: this lot's research found
 * no confirmation that 360dialog's own documented customer-facing webhook *registration* flow
 * (the 360dialog Hub UI + an emailed verification code — see
 * https://docs.360dialog.com/docs/hub/webhook-url.md) actually performs this GET handshake against
 * a customer's endpoint. KORVA is a 360dialog client, not a Meta Tech Provider itself, in the
 * chosen BSP model — so this route may simply never be called by 360dialog in practice. It is
 * inert and harmless if unused, and immediately useful if that research turns out to be
 * incomplete, or if KORVA later registers a webhook directly against Meta.
 */
@Public()
@Controller('webhooks/360dialog')
export class ThreeSixtyDialogWebhookController {
  private readonly logger = new Logger(ThreeSixtyDialogWebhookController.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly integrationWebhookService: IntegrationWebhookService,
  ) {}

  @Get()
  verifyHandshake(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') verifyToken?: string,
    @Query('hub.challenge') challenge?: string,
  ): string {
    const expectedToken = this.configService.get<string>(
      'THREESIXTYDIALOG_WEBHOOK_VERIFY_TOKEN',
    );
    if (
      !expectedToken ||
      mode !== 'subscribe' ||
      !verifyToken ||
      verifyToken !== expectedToken ||
      !challenge
    ) {
      throw new UnauthorizedException({
        code: 'INVALID_WEBHOOK_VERIFY_TOKEN',
        message: 'Webhook verification handshake failed',
      });
    }
    return challenge;
  }

  @Throttle(THREE_SIXTY_DIALOG_WEBHOOK_THROTTLE)
  @Post()
  @HttpCode(200)
  async handle(@Req() req: RequestWithRawBody): Promise<{ received: boolean }> {
    const secret = this.configService.get<string>(
      'THREESIXTYDIALOG_WEBHOOK_SECRET',
    );
    if (!secret) {
      this.logger.error(
        'THREESIXTYDIALOG_WEBHOOK_SECRET is not configured; rejecting an incoming 360dialog webhook call',
      );
      throw new ServiceUnavailableException({
        code: 'THREESIXTYDIALOG_WEBHOOK_NOT_CONFIGURED',
        message: '360dialog webhook receiver is not configured',
      });
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      this.logger.error(
        'req.rawBody is unavailable — NestFactory.create needs { rawBody: true } for 360dialog webhook signature verification to work end-to-end (see ResendWebhookController for the same guard)',
      );
      throw new ServiceUnavailableException({
        code: 'THREESIXTYDIALOG_WEBHOOK_RAW_BODY_UNAVAILABLE',
        message:
          '360dialog webhook receiver cannot verify signatures in this deployment yet',
      });
    }

    const verifier = new ThreeSixtyDialogWebhookVerifier(secret);

    let result: ProcessWebhookResult;
    try {
      result = await this.integrationWebhookService.process({
        provider: '360dialog',
        domain: 'messaging',
        rawBody,
        headers: req.headers,
        verifier,
        extractEventId: extractThreeSixtyDialogEventId,
      });
    } catch {
      throw new BadRequestException({
        code: 'INVALID_360DIALOG_PAYLOAD',
        message: 'Malformed or unrecognized 360dialog webhook payload',
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
}
