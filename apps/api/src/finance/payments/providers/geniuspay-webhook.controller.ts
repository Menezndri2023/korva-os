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
import { ModuleRef } from '@nestjs/core';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import { IntegrationWebhookService } from '../../../integrations/webhooks/integration-webhook.service';
import { PaymentsRepository } from '../payments.repository';
import { PaymentsService } from '../payments.service';
import { GeniusPayWebhookVerifier } from './geniuspay-webhook-verifier';
import { WalletService } from '../../wallet/wallet.service';
import { SubscriptionInvoicesRepository } from '../../../subscriptions/subscription-invoices.repository';
import { SubscriptionBillingService } from '../../../subscription-billing/subscription-billing.service';

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

const GENIUSPAY_WEBHOOK_THROTTLE = { default: { limit: 60, ttl: 60_000 } };

/**
 * POST /api/v1/webhooks/geniuspay — set as the webhook URL in the GeniusPay dashboard, with the
 * `payment.*` events; its `whsec_…` secret goes in GENIUSPAY_WEBHOOK_SECRET.
 *
 * Same discipline as PaystackWebhookController: the signature is checked first; the delivery is
 * recorded once (IntegrationWebhookService dedupes on the event id); and the payment's status is
 * then READ FROM GENIUSPAY (reconcileProcessingPayment → GeniusPayProvider.verifyPayment), never
 * taken from the body. The webhook only makes settlement immediate — the reconciliation sweep
 * settles the same payments without it.
 */
@Public()
@Controller('webhooks/geniuspay')
export class GeniusPayWebhookController {
  private readonly logger = new Logger(GeniusPayWebhookController.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly integrationWebhookService: IntegrationWebhookService,
    private readonly paymentsRepository: PaymentsRepository,
    private readonly paymentsService: PaymentsService,
    private readonly moduleRef: ModuleRef,
    private readonly walletService: WalletService,
  ) {}

  @Throttle(GENIUSPAY_WEBHOOK_THROTTLE)
  @Post()
  @HttpCode(200)
  async handle(@Req() req: RequestWithRawBody): Promise<{ received: boolean }> {
    const secret = this.configService.get<string>('GENIUSPAY_WEBHOOK_SECRET');
    if (!secret) {
      this.logger.error(
        'GENIUSPAY_WEBHOOK_SECRET is not configured; rejecting an incoming GeniusPay webhook call',
      );
      throw new ServiceUnavailableException({
        code: 'GENIUSPAY_WEBHOOK_NOT_CONFIGURED',
        message: 'GeniusPay webhook receiver is not configured',
      });
    }
    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new ServiceUnavailableException({
        code: 'GENIUSPAY_WEBHOOK_RAW_BODY_UNAVAILABLE',
        message:
          'GeniusPay webhook receiver cannot process events in this deployment yet',
      });
    }

    const verifier = new GeniusPayWebhookVerifier(secret);
    const signatureVerified = verifier.verify(rawBody, req.headers);
    const reference = signatureVerified ? extractReference(rawBody) : undefined;
    const organizationId = reference
      ? ((await this.paymentsRepository.findOrganizationIdByProviderReference(
          'geniuspay',
          reference,
        )) ?? undefined)
      : undefined;

    let result: Awaited<ReturnType<IntegrationWebhookService['process']>>;
    try {
      result = await this.integrationWebhookService.process({
        provider: 'geniuspay',
        domain: 'payment',
        rawBody,
        headers: req.headers,
        verifier,
        extractEventId: (payload) => extractEventId(payload),
        organizationId,
      });
    } catch (error) {
      throw new BadRequestException({
        code: 'INVALID_WEBHOOK_PAYLOAD',
        message:
          error instanceof Error
            ? error.message
            : 'Malformed GeniusPay webhook payload',
      });
    }
    if (result.status === 'invalid_signature') {
      throw new UnauthorizedException({
        code: 'INVALID_WEBHOOK_SIGNATURE',
        message: 'Invalid webhook signature',
      });
    }

    if (signatureVerified) {
      // payout.completed / payout.failed: a withdrawal to a business. Again only a trigger —
      // the payout's status is read back from GeniusPay.
      const payoutReference = extractPayoutReference(rawBody);
      if (payoutReference) {
        await this.walletService
          .syncPayoutByReference(payoutReference)
          .catch((error: unknown) =>
            this.logger.error(
              `Payout sync failed for ${payoutReference} — the sweep will retry`,
              error,
            ),
          );
        return { received: true };
      }
    }
    if (reference) await this.reconcile(reference);
    return { received: true };
  }

  private async reconcile(reference: string): Promise<void> {
    try {
      const found = await this.paymentsRepository.findIdByProviderReference(
        'geniuspay',
        reference,
      );
      if (found) {
        await this.paymentsService.reconcileProcessingPayment(
          found.organizationId,
          found.id,
        );
        return;
      }
      // Not a storefront payment: maybe a business paying its KORVA plan. With mobile money the
      // payer often finishes in the Wave / Orange Money app and never comes back to the dashboard
      // (where verifyPayment used to be the only trigger), so the webhook settles it too.
      // Resolved lazily through ModuleRef: SubscriptionBillingModule depends on the payment
      // providers, so importing it into FinanceModule would close a module cycle.
      const invoice = await this.moduleRef
        .get(SubscriptionInvoicesRepository, { strict: false })
        .findOpenByProviderReference(reference);
      if (invoice) {
        await this.moduleRef
          .get(SubscriptionBillingService, { strict: false })
          .verifyPayment(
            invoice.organizationId.toString(),
            invoice.id as string,
          );
      }
    } catch (error) {
      this.logger.error(
        `Webhook-triggered reconciliation failed for GeniusPay reference ${reference} — the periodic sweep will retry`,
        error,
      );
    }
  }
}

function dataOf(
  payload: Record<string, unknown>,
): Record<string, unknown> | undefined {
  return typeof payload.data === 'object' && payload.data !== null
    ? (payload.data as Record<string, unknown>)
    : undefined;
}

/** The delivery's own id (`id`, a UUID), else the transaction's — for deduplication only. */
export function extractEventId(payload: Record<string, unknown>): string {
  if (typeof payload.id === 'string' && payload.id) return payload.id;
  const data = dataOf(payload);
  const reference = data?.reference;
  const event = typeof payload.event === 'string' ? payload.event : 'event';
  if (typeof reference === 'string' && reference)
    return `${event}:${reference}`;
  if (typeof data?.id === 'number') return `${event}:${data.id}`;
  throw new Error(
    'GeniusPay webhook payload has neither an id nor a transaction reference',
  );
}

/** `data.reference` — the "MTX-…" value GeniusPayProvider.createPayment stored as the Payment's
 *  providerReference. Nothing else in the body is trusted. */
export function extractReference(rawBody: Buffer): string | undefined {
  try {
    const payload = JSON.parse(rawBody.toString('utf8')) as Record<
      string,
      unknown
    >;
    const reference = dataOf(payload)?.reference;
    return typeof reference === 'string' && reference ? reference : undefined;
  } catch {
    return undefined;
  }
}

/** A payout event (`payout.*`) names the withdrawal at `data.payout.reference`. */
export function extractPayoutReference(rawBody: Buffer): string | undefined {
  try {
    const payload = JSON.parse(rawBody.toString('utf8')) as Record<
      string,
      unknown
    >;
    if (
      typeof payload.event !== 'string' ||
      !payload.event.startsWith('payout.')
    ) {
      return undefined;
    }
    const data = dataOf(payload);
    const payout =
      data && typeof data.payout === 'object' && data.payout !== null
        ? (data.payout as Record<string, unknown>)
        : data;
    const reference = payout?.reference;
    return typeof reference === 'string' && reference ? reference : undefined;
  } catch {
    return undefined;
  }
}
