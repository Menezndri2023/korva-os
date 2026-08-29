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
    private readonly paymentsRepository: PaymentsRepository,
    private readonly paymentsService: PaymentsService,
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

    // Stage 2.5 — tenant attribution. Resolved here, BEFORE calling the generic pipeline, and
    // only after independently verifying the signature ourselves first: attribution must never
    // be attempted on an unverified payload (see docs/architecture/integrations-platform.md §8
    // addendum). `process()` below still runs its own internal `verifier.verify()` regardless —
    // this call is deliberately redundant with it, not a replacement, so tenant resolution never
    // becomes a second, weaker gate that could substitute for the real one.
    const signatureVerified = verifier.verify(rawBody, req.headers);
    const txRef = signatureVerified ? this.extractTxRef(rawBody) : undefined;
    const organizationId = txRef
      ? ((await this.paymentsRepository.findOrganizationIdByProviderReference(
          'flutterwave',
          txRef,
        )) ?? undefined)
      : undefined;

    let result: Awaited<ReturnType<IntegrationWebhookService['process']>>;
    try {
      result = await this.integrationWebhookService.process({
        provider: 'flutterwave',
        domain: 'payment',
        rawBody,
        headers: req.headers,
        verifier,
        extractEventId: (payload) => this.extractEventId(payload),
        organizationId,
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

    // Stage 2.6 — latency optimization, never a correctness dependency: triggers the exact same
    // reconciliation PaymentReconciliationService's periodic sweep would eventually run for this
    // Payment anyway (see PaymentsService.reconcileProcessingPayment), instead of waiting up to
    // PAYMENT_RECONCILIATION_INTERVAL_MS. Deliberately does NOT trust anything in the webhook
    // body for the actual mutation — reconcileProcessingPayment only ever finalizes based on an
    // authenticated PaymentProvider.getPaymentStatus() call it makes itself, so this is safe
    // regardless of Flutterwave's `verif-hash` scheme not being a body-integrity HMAC (see
    // flutterwave-webhook-verifier.ts's own doc comment). Runs on BOTH 'processed' and
    // 'duplicate' (never on 'invalid_signature', already excluded above) since a redelivered
    // webhook is just as valid a trigger to check again; a no-op read if the Payment is already
    // resolved. Never allowed to affect this endpoint's own 200 OK acknowledgment to
    // Flutterwave — a failure here (including "no matching Payment yet", txRef unresolved, or
    // organizationId unresolved) is swallowed after logging, exactly like a periodic sweep
    // candidate failure already is in PaymentReconciliationService itself.
    if (txRef) {
      await this.triggerImmediateReconciliation(txRef);
    }

    return { received: true };
  }

  /**
   * Stage 2.6 — looks up the Payment this (already-verified) webhook's tx_ref refers to and asks
   * PaymentsService to reconcile it now, instead of waiting for the next periodic sweep. Never
   * throws: every failure mode here (no matching Payment yet, organizationId mismatch, provider
   * unreachable) is a legitimate "nothing to do yet, the sweep will catch it" outcome, not a
   * reason to fail this webhook delivery.
   */
  private async triggerImmediateReconciliation(txRef: string): Promise<void> {
    try {
      const found = await this.paymentsRepository.findIdByProviderReference(
        'flutterwave',
        txRef,
      );
      if (!found) return;
      await this.paymentsService.reconcileProcessingPayment(
        found.organizationId,
        found.id,
      );
    } catch (error) {
      this.logger.error(
        `Webhook-triggered reconciliation failed for tx_ref ${txRef} — the periodic sweep will retry`,
        error,
      );
    }
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

  /**
   * Stage 2.5 — extracts the merchant reference this (already signature-verified) webhook is
   * about. KORVA is Merchant-of-Record for Flutterwave (one platform-level account, not a
   * per-tenant credential the way 360dialog is — see docs/decisions/psp-provider.md) so there is
   * no per-tenant "Flutterwave account" to identify here; instead this uses the
   * already-established "payment/invoice relationship" (docs/architecture/integrations-platform.md
   * §8 addendum): `data.tx_ref` is the merchant reference this codebase itself generates
   * (`korva_${invoiceId}_...`, see flutterwave-payment.provider.ts's `createPayment`) and persists
   * as `Payment.providerReference` at checkout-creation time — so looking that Payment back up by
   * `(provider, providerReference)` gives the real, KORVA-recorded organizationId (Stage 2.5) and
   * Payment id (Stage 2.6), never anything the webhook payload itself claims. Deliberately does
   * NOT fall back to `data.id` the way `extractEventId` does — `data.id` is Flutterwave's own
   * numeric id, never what's stored as `providerReference` (see that adapter's own doc comment),
   * so it could never match a Payment here anyway. A malformed body or a missing `tx_ref` both
   * resolve to `undefined` — never thrown, never guessed.
   */
  private extractTxRef(rawBody: Buffer): string | undefined {
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
    const txRef = data?.tx_ref;
    return typeof txRef === 'string' && txRef.length > 0 ? txRef : undefined;
  }
}
