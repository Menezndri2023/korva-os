import { Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { PaymentStatus } from '@korva/types';
import type {
  PaymentProvider,
  PaymentProviderResult,
} from './payment-provider.interface';

/**
 * Real adapter for Paystack's REST API (Merchant-of-Record — West/Southern/East African
 * markets Flutterwave doesn't cover well, per docs/BUSINESS_OS_AUDIT.md §6: "despite
 * PaymentProvider abstraction being ready for them, only Flutterwave has a real adapter").
 *
 * ## What was verified vs. what is assumed
 * Endpoints, request/response field names, and the webhook scheme below were confirmed via live
 * web search (2026-08-29) against Paystack's own documentation and cross-checked against multiple
 * independent secondary sources quoting identical field names (Paystack's docs domain itself
 * returns HTTP 403 to automated fetches, same limitation noted for Flutterwave's v3 docs when
 * that adapter was built). No live sandbox call was ever made — no credentials exist in this
 * environment — so, exactly like FlutterwaveProvider, nothing here is "proven against sandbox,"
 * only "matches what the docs currently say."
 *
 * ## The one detail that actually differs structurally from Flutterwave
 * Paystack amounts are always in the SMALLEST currency unit (kobo for NGN, cents for
 * USD/GHS-pesewas/ZAR, etc.) — unlike Flutterwave v3, which takes major units directly. Every
 * amount sent to Paystack is `Math.round(amount * 100)`; nothing read back from Paystack is ever
 * converted back to major units in this adapter, since no method here needs to report an amount,
 * only a status. Getting this conversion wrong is a classic, well-known PSP-integration bug —
 * called out explicitly here rather than left implicit.
 */

const PAYSTACK_API_BASE_URL = 'https://api.paystack.co';
const PAYSTACK_REQUEST_TIMEOUT_MS = 15_000;

/** Thrown for every Paystack failure mode this adapter can detect: non-2xx response, non-JSON
 *  body, or a JSON body missing the top-level `status` boolean every Paystack response documents.
 *  Never thrown for a legitimately-reported business failure with a well-formed response (e.g.
 *  Paystack reporting `data.status: "failed"` for a declined card is a normal, typed
 *  `PaymentProviderResult`, not an exception) — same split as FlutterwaveApiError. */
export class PaystackApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: unknown,
    /** Set ONLY for the network-error/timeout branch of `request()` — see FlutterwaveApiError's
     *  own doc comment on this exact field for the full reasoning (identical here). */
    public readonly ambiguous?: true,
    /** Set ONLY by createPayment()'s own catch-and-rethrow — see FlutterwaveApiError's own doc
     *  comment on this exact field for the full reasoning (identical here). */
    public readonly generatedReference?: string,
  ) {
    super(message);
    this.name = 'PaystackApiError';
  }
}

interface PaystackEnvelope {
  status: boolean;
  message?: string;
  data?: unknown;
}

/**
 * `PaymentProvider.createPayment`'s interface-level `customerEmail`/`redirectUrl` are optional
 * (a manual/staff-recorded payment has neither) — this adapter makes both REQUIRED (TypeScript's
 * bivariant method-parameter checking allows this while still satisfying the interface),
 * matching FlutterwaveCreatePaymentInput's own reasoning:
 *
 * - `customerEmail` is REQUIRED by Paystack's real Initialize Transaction API (`email`) — same
 *   "no sane fallback" reasoning as Flutterwave's adapter.
 * - `redirectUrl` is optional on Paystack's side (it falls back to a dashboard-configured
 *   default, and Paystack's own field is named `callback_url`) but required by this adapter for
 *   the same "a hosted checkout link with nowhere to return the customer to is not a usable real
 *   integration" reasoning as Flutterwave's adapter — named `redirectUrl` here (not
 *   `callbackUrl`) specifically so a caller coding against the shared `PaymentProvider` interface
 *   can pass one common field name regardless of which provider gets resolved.
 */
export interface PaystackCreatePaymentInput {
  amount: number;
  currency: string;
  invoiceId: string;
  customerEmail: string;
  redirectUrl: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export class PaystackProvider implements PaymentProvider {
  readonly name = 'paystack';
  private readonly logger = new Logger(PaystackProvider.name);

  /**
   * @param secretKey Paystack secret key (`sk_live_...`/`sk_test_...`), sent as `Authorization:
   * Bearer <secretKey>` on every request. Never read from `process.env`/`ConfigService` inside
   * this class — same constructor-injection convention as FlutterwaveProvider/ResendEmailProvider;
   * the decrypted key is handed in by `PaymentProviderRegistry`. Fails closed independently of the
   * registry, same reasoning as FlutterwaveProvider's own constructor guard.
   */
  constructor(private readonly secretKey: string) {
    if (!secretKey) {
      throw new PaystackApiError(
        'PaystackProvider requires a non-empty secret key — refusing to construct an adapter that would send Authorization: Bearer <empty>',
      );
    }
  }

  /**
   * Calls Paystack's Initialize Transaction endpoint: `POST https://api.paystack.co/transaction/
   * initialize`. On success, Paystack returns only a hosted checkout `data.authorization_url` — no
   * final payment status. This adapter always generates and sends its OWN `reference` (rather than
   * letting Paystack auto-generate one) so `providerReference` is deterministic and known
   * immediately, matching FlutterwaveProvider's own `tx_ref` pattern exactly — same reasoning:
   * `verifyPayment`/`getPaymentStatus`/`refundPayment` below are all written around this reference.
   * Status is always `'pending'`, never `'completed'` — "HTTP 200 ≠ paid" (same invariant
   * FlutterwaveProvider's own class doc cites).
   */
  async createPayment(
    input: PaystackCreatePaymentInput,
  ): Promise<PaymentProviderResult> {
    const reference = `korva_${input.invoiceId}_${randomBytes(8).toString('hex')}`;

    const body: Record<string, unknown> = {
      reference,
      email: input.customerEmail,
      amount: toMinorUnits(input.amount),
      currency: input.currency,
      callback_url: input.redirectUrl,
    };

    // Same correlation-capture reasoning as FlutterwaveProvider.createPayment's own comment:
    // `reference` was already generated and already sent to Paystack by the time any error from
    // request() below could be thrown — re-thrown with `generatedReference` attached so it's
    // never silently lost, never treated as evidence the payment was actually created.
    let response: PaystackEnvelope;
    try {
      response = await this.request('/transaction/initialize', 'POST', body);
    } catch (error) {
      if (error instanceof PaystackApiError) {
        throw new PaystackApiError(
          error.message,
          error.statusCode,
          error.responseBody,
          error.ambiguous,
          reference,
        );
      }
      throw error;
    }
    const data = isRecord(response.data) ? response.data : undefined;
    const authorizationUrl = data?.authorization_url;
    if (
      !response.status ||
      typeof authorizationUrl !== 'string' ||
      !authorizationUrl
    ) {
      throw new PaystackApiError(
        'Paystack did not return an authorization_url for this payment',
        undefined,
        response,
      );
    }

    return {
      providerReference: reference,
      status: 'pending',
      checkoutUrl: authorizationUrl,
    };
  }

  /**
   * Calls Paystack's Verify Transaction endpoint: `GET https://api.paystack.co/transaction/
   * verify/<reference>`. `data.status` is documented to be `"success"`, `"failed"`, or
   * `"abandoned"` (a checkout started but never completed) — `"abandoned"` maps to `'failed'`
   * since `PaymentStatus` has no equivalent "never finished" state and an abandoned checkout is,
   * from KORVA's side, exactly as unpaid as a declined one.
   */
  async verifyPayment(
    providerReference: string,
  ): Promise<PaymentProviderResult> {
    const response = await this.request(
      `/transaction/verify/${encodeURIComponent(providerReference)}`,
      'GET',
    );
    return this.toPaymentResult(providerReference, response);
  }

  async getPaymentStatus(providerReference: string): Promise<PaymentStatus> {
    const result = await this.verifyPayment(providerReference);
    return result.status;
  }

  /**
   * Calls Paystack's Create Refund endpoint: `POST https://api.paystack.co/refund`. Unlike
   * Flutterwave (which requires resolving a separate numeric transaction id first via a
   * verify-by-reference call — see FlutterwaveProvider.refundPayment's own doc comment), Paystack
   * documents `transaction` as accepting EITHER the transaction reference or id directly — this is
   * a genuine one-step call, not a simplification.
   *
   * Paystack's own docs describe a successful refund-creation response as "queued for
   * processing," with the authoritative outcome delivered later via `refund.processed`/
   * `refund.failed` webhook events — not guaranteed final at this response. This adapter still
   * returns `'refunded'` optimistically on a successful creation call, matching
   * FlutterwaveProvider.refundPayment's own identical posture (documented, not yet verified
   * against a live/sandbox call — see that method's own "Stage 2.7A" doc comment for the same
   * caveat applied there).
   *
   * `localReferenceForReconciliation`, when given, is sent as Paystack's own documented
   * `merchant_note` field (a free-text note on the refund) — the closest Paystack equivalent to
   * Flutterwave's `comments` field this adapter's own sibling method uses for the same parameter.
   */
  async refundPayment(
    providerReference: string,
    amount: number,
    localReferenceForReconciliation?: string,
  ): Promise<PaymentProviderResult> {
    const response = await this.request('/refund', 'POST', {
      transaction: providerReference,
      amount: toMinorUnits(amount),
      ...(localReferenceForReconciliation
        ? { merchant_note: localReferenceForReconciliation }
        : {}),
    });
    if (!response.status) {
      throw new PaystackApiError(
        `Paystack refund request failed for reference "${providerReference}"`,
        undefined,
        response,
      );
    }

    // Same purely-defensive, additive extraction posture as FlutterwaveProvider.refundPayment's
    // own Stage 2.12 comment: type-guarded, only included when actually present, never fabricated,
    // never required for the refund to be considered successful.
    const data = isRecord(response.data) ? response.data : undefined;
    const rawRefundId = data?.id;
    const providerRefundId =
      typeof rawRefundId === 'string'
        ? rawRefundId
        : typeof rawRefundId === 'number'
          ? String(rawRefundId)
          : undefined;
    const rawRefundReference = data?.reference;
    const providerRefundReference =
      typeof rawRefundReference === 'string' ? rawRefundReference : undefined;

    return {
      providerReference,
      status: 'refunded',
      ...(providerRefundId ? { providerRefundId } : {}),
      ...(providerRefundReference ? { providerRefundReference } : {}),
    };
  }

  /**
   * Cheapest real authenticated call that fails immediately with bad credentials: Paystack's
   * Check Balance endpoint, `GET https://api.paystack.co/balance` — same "pure auth-and-nothing-
   * else check" reasoning as FlutterwaveProvider.testConnection's own choice of `/balances`.
   */
  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    try {
      const response = await this.request('/balance', 'GET');
      if (response.status) {
        return { ok: true };
      }
      return {
        ok: false,
        message: response.message ?? 'Paystack rejected the request',
      };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : 'Unknown Paystack error',
      };
    }
  }

  private mapTransactionStatus(paystackStatus: string): PaymentStatus {
    switch (paystackStatus) {
      case 'success':
        return 'completed';
      case 'failed':
      case 'abandoned':
        return 'failed';
      default:
        throw new PaystackApiError(
          `Unrecognized Paystack transaction status "${paystackStatus}"`,
        );
    }
  }

  private toPaymentResult(
    providerReference: string,
    response: PaystackEnvelope,
  ): PaymentProviderResult {
    const data = isRecord(response.data) ? response.data : undefined;
    const status = data?.status;
    if (!response.status || typeof status !== 'string') {
      throw new PaystackApiError(
        `Paystack verify response for reference "${providerReference}" is missing a transaction status`,
        undefined,
        response,
      );
    }
    return {
      providerReference,
      status: this.mapTransactionStatus(status),
    };
  }

  /**
   * Plain global `fetch()`, no HTTP client library — same convention as FlutterwaveProvider/
   * ResendEmailProvider. `safe-fetch.ts`'s SSRF guard is deliberately NOT used here for the same
   * reason FlutterwaveProvider's own `request()` doesn't use it: every URL here is a path appended
   * to the hardcoded, first-party `PAYSTACK_API_BASE_URL` constant, never a tenant-supplied host.
   */
  private async request(
    path: string,
    method: 'GET' | 'POST',
    body?: Record<string, unknown>,
  ): Promise<PaystackEnvelope> {
    let response: Response;
    try {
      response = await fetch(`${PAYSTACK_API_BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(PAYSTACK_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown network error';
      this.logger.error(`Paystack request to ${path} failed: ${message}`);
      throw new PaystackApiError(
        `Network error calling Paystack (${path}): ${message}`,
        undefined,
        undefined,
        true,
      );
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new PaystackApiError(
        `Paystack returned a non-JSON response (HTTP ${response.status}) for ${path}`,
        response.status,
      );
    }

    if (!isRecord(parsed) || typeof parsed.status !== 'boolean') {
      throw new PaystackApiError(
        `Paystack returned an unexpected response shape for ${path}`,
        response.status,
        parsed,
      );
    }

    if (!response.ok) {
      const message =
        typeof parsed.message === 'string'
          ? parsed.message
          : `Paystack responded with status ${response.status}`;
      throw new PaystackApiError(message, response.status, parsed);
    }

    return {
      status: parsed.status,
      message: typeof parsed.message === 'string' ? parsed.message : undefined,
      data: parsed.data,
    };
  }
}

/** Paystack amounts are always in the smallest currency unit — see this file's own class doc. */
function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}
