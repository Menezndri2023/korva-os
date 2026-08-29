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
import { PaymentsRepository } from '../payments.repository';
import { PaymentsService } from '../payments.service';
import { PaystackWebhookVerifier } from './paystack-webhook-verifier';

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

/** Same shape/reasoning as FLUTTERWAVE_WEBHOOK_THROTTLE. */
const PAYSTACK_WEBHOOK_THROTTLE = { default: { limit: 60, ttl: 60_000 } };

/**
 * Receives Paystack's async payment-status webhooks and hands them to the generic, already-
 * tested pipeline (`IntegrationWebhookService.process`) — same division of labor as
 * FlutterwaveWebhookController (see that file's own class doc for the full division-of-labor
 * reasoning, identical here).
 *
 * Reads `PAYSTACK_SECRET_KEY` directly (not a separate webhook-only secret, unlike Flutterwave's
 * `FLUTTERWAVE_WEBHOOK_SECRET_HASH`): Paystack's own model signs webhooks with the SAME secret
 * key used to authenticate API calls (see PaystackWebhookVerifier's own doc comment) — there is
 * no separate webhook credential to configure. This is a deliberate simplification: it assumes a
 * single platform-wide Paystack secret (matching `PaymentProviderRegistry`'s current single-entry
 * assumption per provider), read independently of whichever `IntegrationAccount` secret the
 * registry actually decrypts for a given (role, market) — `FinanceModule` cannot import
 * `IntegrationsModule` to look that account up directly without creating a circular dependency
 * (see finance.module.ts's own comment on this). If KORVA ever configures multiple Paystack
 * platform accounts with genuinely different secrets across markets, this verification would need
 * revisiting; today it does not.
 */
@Public()
@Controller('webhooks/paystack')
export class PaystackWebhookController {
  private readonly logger = new Logger(PaystackWebhookController.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly integrationWebhookService: IntegrationWebhookService,
    private readonly paymentsRepository: PaymentsRepository,
    private readonly paymentsService: PaymentsService,
  ) {}

  @Throttle(PAYSTACK_WEBHOOK_THROTTLE)
  @Post()
  @HttpCode(200)
  async handle(@Req() req: RequestWithRawBody): Promise<{ received: boolean }> {
    const secretKey = this.configService.get<string>('PAYSTACK_SECRET_KEY');
    if (!secretKey) {
      this.logger.error(
        'PAYSTACK_SECRET_KEY is not configured; rejecting an incoming Paystack webhook call',
      );
      throw new ServiceUnavailableException({
        code: 'PAYSTACK_WEBHOOK_NOT_CONFIGURED',
        message: 'Paystack webhook receiver is not configured',
      });
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      this.logger.error(
        'req.rawBody is unavailable — NestFactory.create needs { rawBody: true } for Paystack webhook signature verification to work end-to-end (see ResendWebhookController/FlutterwaveWebhookController for the same guard)',
      );
      throw new ServiceUnavailableException({
        code: 'PAYSTACK_WEBHOOK_RAW_BODY_UNAVAILABLE',
        message:
          'Paystack webhook receiver cannot process events in this deployment yet',
      });
    }

    const verifier = new PaystackWebhookVerifier(secretKey);

    // Same attribution-only-after-independent-verification ordering as
    // FlutterwaveWebhookController — see that file's own comment for the full reasoning.
    const signatureVerified = verifier.verify(rawBody, req.headers);
    const reference = signatureVerified
      ? this.extractReference(rawBody)
      : undefined;
    const organizationId = reference
      ? ((await this.paymentsRepository.findOrganizationIdByProviderReference(
          'paystack',
          reference,
        )) ?? undefined)
      : undefined;

    let result: Awaited<ReturnType<IntegrationWebhookService['process']>>;
    try {
      result = await this.integrationWebhookService.process({
        provider: 'paystack',
        domain: 'payment',
        rawBody,
        headers: req.headers,
        verifier,
        extractEventId: (payload) => this.extractEventId(payload),
        organizationId,
      });
    } catch (error) {
      throw new BadRequestException({
        code: 'INVALID_WEBHOOK_PAYLOAD',
        message:
          error instanceof Error
            ? error.message
            : 'Malformed Paystack webhook payload',
      });
    }

    if (result.status === 'invalid_signature') {
      throw new UnauthorizedException({
        code: 'INVALID_WEBHOOK_SIGNATURE',
        message: 'Invalid webhook signature',
      });
    }

    // Same latency-optimization-never-a-correctness-dependency reasoning as
    // FlutterwaveWebhookController's own `triggerImmediateReconciliation` call.
    if (reference) {
      await this.triggerImmediateReconciliation(reference);
    }

    return { received: true };
  }

  private async triggerImmediateReconciliation(
    reference: string,
  ): Promise<void> {
    try {
      const found = await this.paymentsRepository.findIdByProviderReference(
        'paystack',
        reference,
      );
      if (!found) return;
      await this.paymentsService.reconcileProcessingPayment(
        found.organizationId,
        found.id,
      );
    } catch (error) {
      this.logger.error(
        `Webhook-triggered reconciliation failed for reference ${reference} — the periodic sweep will retry`,
        error,
      );
    }
  }

  /**
   * Paystack webhook event payloads carry `data.id` (Paystack's own numeric transaction/refund
   * id) on every documented event type; falls back to `data.reference` (the merchant reference
   * this adapter generates in paystack-payment.provider.ts's `createPayment`) if `id` is absent.
   * Throws if neither is present — same contract as FlutterwaveWebhookController's own
   * `extractEventId`.
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

    const reference = data?.reference;
    if (typeof reference === 'string' && reference.length > 0) {
      return reference;
    }

    throw new Error(
      'Paystack webhook payload is missing both data.id and data.reference',
    );
  }

  /**
   * Extracts the merchant reference this (already signature-verified) webhook is about —
   * `data.reference`, the value this codebase itself generates and persists as
   * `Payment.providerReference` at checkout-creation time (see paystack-payment.provider.ts's
   * `createPayment`). Same "look the Payment back up by (provider, providerReference), never
   * trust anything else the payload claims" reasoning as FlutterwaveWebhookController's own
   * `extractTxRef` — deliberately does NOT fall back to `data.id` for the same reason that method
   * doesn't: `data.id` is Paystack's own numeric id, never what's stored as `providerReference`.
   */
  private extractReference(rawBody: Buffer): string | undefined {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    } catch {
      return undefined;
    }

    const data =
      typeof payload.data === 'object' && payload.data !== null
        ? (payload.data as Record<string, unknown>)
        : undefined;
    const reference = data?.reference;
    return typeof reference === 'string' && reference.length > 0
      ? reference
      : undefined;
  }
}
