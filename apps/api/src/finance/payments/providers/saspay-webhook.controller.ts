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
import { WalletService } from '../../wallet/wallet.service';
import { SubscriptionInvoicesRepository } from '../../../subscriptions/subscription-invoices.repository';
import { SubscriptionBillingService } from '../../../subscription-billing/subscription-billing.service';
import { PaymentProviderResolverService } from './payment-provider-resolver.service';
import { SasPayProvider } from './saspay-payment.provider';
import { SasPayWebhookVerifier } from './saspay-webhook-verifier';

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

const SASPAY_WEBHOOK_THROTTLE = { default: { limit: 60, ttl: 60_000 } };

/**
 * POST /api/v1/webhooks/saspay — created in SasPay's dashboard (Développeur → Webhooks) with at
 * least `transaction.success` and `transaction.failed`; its signing secret goes in
 * SASPAY_WEBHOOK_SECRET.
 *
 * Same discipline as the GeniusPay receiver: signature first, delivery recorded once, and the
 * outcome READ BACK FROM SASPAY (verifyPayment / getPayout), never taken from the body. The body
 * is only a hint of which payment or withdrawal to look at:
 *
 *   - a withdrawal: `data.id` is the payout's own id, which KORVA stored as providerReference;
 *   - a payment: `data.id` is SasPay's TRANSACTION, while KORVA stored the checkout SESSION, so
 *     the session carrying that transaction is looked up first (SasPayProvider).
 *
 * Nothing is lost when this fails: the reconciliation sweep asks SasPay about every open payment.
 */
@Public()
@Controller('webhooks/saspay')
export class SasPayWebhookController {
  private readonly logger = new Logger(SasPayWebhookController.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly integrationWebhookService: IntegrationWebhookService,
    private readonly paymentsRepository: PaymentsRepository,
    private readonly paymentsService: PaymentsService,
    private readonly moduleRef: ModuleRef,
    private readonly walletService: WalletService,
    private readonly providerResolver: PaymentProviderResolverService,
  ) {}

  @Throttle(SASPAY_WEBHOOK_THROTTLE)
  @Post()
  @HttpCode(200)
  async handle(@Req() req: RequestWithRawBody): Promise<{ received: boolean }> {
    const secret = this.configService.get<string>('SASPAY_WEBHOOK_SECRET');
    if (!secret) {
      this.logger.error(
        'SASPAY_WEBHOOK_SECRET is not configured; rejecting an incoming SasPay webhook call',
      );
      throw new ServiceUnavailableException({
        code: 'SASPAY_WEBHOOK_NOT_CONFIGURED',
        message: 'SasPay webhook receiver is not configured',
      });
    }
    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new ServiceUnavailableException({
        code: 'SASPAY_WEBHOOK_RAW_BODY_UNAVAILABLE',
        message:
          'SasPay webhook receiver cannot process events in this deployment yet',
      });
    }

    const verifier = new SasPayWebhookVerifier(secret);
    const signatureVerified = verifier.verify(rawBody, req.headers);
    const event = signatureVerified ? parseEvent(rawBody) : undefined;

    let result: Awaited<ReturnType<IntegrationWebhookService['process']>>;
    try {
      result = await this.integrationWebhookService.process({
        provider: 'saspay',
        domain: 'payment',
        rawBody,
        headers: req.headers,
        verifier,
        extractEventId: (payload) => extractEventId(payload),
      });
    } catch (error) {
      throw new BadRequestException({
        code: 'INVALID_WEBHOOK_PAYLOAD',
        message:
          error instanceof Error
            ? error.message
            : 'Malformed SasPay webhook payload',
      });
    }
    if (result.status === 'invalid_signature') {
      throw new UnauthorizedException({
        code: 'INVALID_WEBHOOK_SIGNATURE',
        message: 'Invalid webhook signature',
      });
    }
    if (!event?.transactionId) return { received: true };

    // A withdrawal? Its id is a payout's providerReference; a payment's id never is.
    const isPayout = await this.walletService
      .syncPayoutByReference(event.transactionId)
      .catch((error: unknown) => {
        this.logger.error(
          `Payout sync failed for ${event.transactionId} — the sweep will retry`,
          error,
        );
        return event.type === 'RETRAIT';
      });
    if (isPayout || event.type === 'RETRAIT') return { received: true };

    await this.reconcilePayment(event.transactionId);
    return { received: true };
  }

  private async reconcilePayment(transactionId: string): Promise<void> {
    try {
      const provider = await this.providerResolver.resolve({
        flow: 'subscription',
        organizationId: '',
      });
      if (!(provider instanceof SasPayProvider)) return;
      const sessionId =
        await provider.findSessionIdForTransaction(transactionId);
      if (!sessionId) return;

      const found = await this.paymentsRepository.findIdByProviderReference(
        'saspay',
        sessionId,
      );
      if (found) {
        await this.paymentsService.reconcileProcessingPayment(
          found.organizationId,
          found.id,
        );
        return;
      }
      // Not a storefront payment: maybe a business paying its KORVA plan (resolved lazily, as in
      // the GeniusPay receiver, to keep FinanceModule out of a module cycle).
      const invoice = await this.moduleRef
        .get(SubscriptionInvoicesRepository, { strict: false })
        .findOpenByProviderReference(sessionId);
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
        `Webhook-triggered reconciliation failed for SasPay transaction ${transactionId} — the periodic sweep will retry`,
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

/** SasPay sends no delivery id: the event, the transaction and its status name the delivery. */
export function extractEventId(payload: Record<string, unknown>): string {
  const event = typeof payload.event === 'string' ? payload.event : 'event';
  const data = dataOf(payload);
  const id = data?.id;
  if (typeof id === 'string' && id) {
    const status = typeof data?.status === 'string' ? `:${data.status}` : '';
    return `${event}:${id}${status}`;
  }
  if (event === 'webhook.test') return `webhook.test:${Date.now()}`;
  throw new Error('SasPay webhook payload has no transaction id');
}

/** Only `transaction.*` events name something KORVA tracks; `type` tells payment from payout. */
export function parseEvent(
  rawBody: Buffer,
): { transactionId?: string; type?: string } | undefined {
  try {
    const payload = JSON.parse(rawBody.toString('utf8')) as Record<
      string,
      unknown
    >;
    if (
      typeof payload.event !== 'string' ||
      !payload.event.startsWith('transaction.')
    ) {
      return undefined;
    }
    const data = dataOf(payload);
    return {
      transactionId:
        typeof data?.id === 'string' && data.id ? data.id : undefined,
      type: typeof data?.type === 'string' ? data.type : undefined,
    };
  } catch {
    return undefined;
  }
}
