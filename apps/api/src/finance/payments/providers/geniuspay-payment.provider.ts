import { Logger, UnprocessableEntityException } from '@nestjs/common';
import type { PaymentStatus } from '@korva/types';
import type {
  PaymentProvider,
  PaymentProviderResult,
  PayoutRequest,
  PayoutResult,
} from './payment-provider.interface';

/**
 * GeniusPay (pay.genius.ci) — mobile money for West and Central Africa: Wave, Orange Money, MTN
 * Mobile Money, Moov Money, plus cards, behind ONE hosted checkout page. Reference:
 * https://pay.genius.ci/doc (read 2026-10-28):
 *
 *   POST /api/v1/merchant/payments            create (no payment_method → a checkout page where
 *                                             the payer picks Wave / Orange / MTN / Moov / card)
 *   GET  /api/v1/merchant/payments/{ref}      status of one payment (ref = "MTX-XXXXXXXXXX")
 *   GET  /api/v1/merchant/account             used by testConnection
 *   headers X-API-Key: pk_(sandbox|live)_…   X-API-Secret: sk_(sandbox|live)_…
 *
 * Sandbox and live share the base URL; the key pair decides (pk_sandbox_… vs pk_live_…).
 * Amounts are whole units (XOF has no minor unit; the documented minimum is 200 XOF).
 *
 * The credential is TWO keys, stored as the platform IntegrationAccount's single encrypted
 * secret — "pk_… sk_…" (whitespace-separated) or JSON {"apiKey":"pk_…","apiSecret":"sk_…"}.
 * See parseGeniusPayCredential.
 *
 * Not offered by GeniusPay's documented API, so not offered here:
 *   - refunds (no endpoint documented): refundPayment fails with a typed error telling staff to
 *     refund from the GeniusPay dashboard;
 *   - saved payment methods (no reusable authorization): no chargeRecurring — KORVA's plan
 *     renewals then fall back to an invoice with a payment link, as for any such provider.
 */
export const GENIUSPAY_API_BASE_URL = 'https://pay.genius.ci/api/v1/merchant';
const GENIUSPAY_REQUEST_TIMEOUT_MS = 20_000;

export class GeniusPayApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: unknown,
    /** Network error / timeout: no HTTP answer, so KORVA cannot know whether GeniusPay acted —
     *  see AmbiguousProviderErrorMarker. */
    public readonly ambiguous?: true,
  ) {
    super(message);
    this.name = 'GeniusPayApiError';
  }
}

export interface GeniusPayCredential {
  apiKey: string;
  apiSecret: string;
}

/** Fails closed: anything that is not one pk_ key AND one sk_ key of the same environment. */
export function parseGeniusPayCredential(secret: string): GeniusPayCredential {
  let apiKey: string | undefined;
  let apiSecret: string | undefined;
  const trimmed = secret.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      apiKey = typeof parsed.apiKey === 'string' ? parsed.apiKey : undefined;
      apiSecret =
        typeof parsed.apiSecret === 'string' ? parsed.apiSecret : undefined;
    } catch {
      // falls through to the error below
    }
  } else {
    const parts = trimmed.split(/[\s|]+/).filter(Boolean);
    apiKey = parts.find((part) => part.startsWith('pk_'));
    apiSecret = parts.find((part) => part.startsWith('sk_'));
  }
  const environment = (key: string) => key.split('_')[1];
  if (
    !apiKey?.startsWith('pk_') ||
    !apiSecret?.startsWith('sk_') ||
    environment(apiKey) !== environment(apiSecret)
  ) {
    throw new GeniusPayApiError(
      'GeniusPay credential must hold a public key (pk_…) and a secret key (sk_…) of the same environment',
    );
  }
  return { apiKey, apiSecret };
}

interface GeniusPayEnvelope {
  success?: boolean;
  message?: string;
  data?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** GeniusPay's statuses as documented (the page lists two overlapping sets; both are covered). */
export function mapGeniusPayStatus(status: string): PaymentStatus {
  switch (status) {
    case 'completed':
    case 'success':
      return 'completed';
    case 'pending':
    case 'initiated':
      return 'pending';
    case 'processing':
      return 'processing';
    case 'failed':
    case 'cancelled':
    case 'expired':
      return 'failed';
    case 'refunded':
      return 'refunded';
    default:
      throw new GeniusPayApiError(
        `Unrecognized GeniusPay payment status "${status}"`,
      );
  }
}

export class GeniusPayProvider implements PaymentProvider {
  readonly name = 'geniuspay';
  /** "currency: XOF, EUR, USD" per the create-payment reference. */
  readonly supportedCurrencies = ['XOF', 'EUR', 'USD'] as const;
  private readonly logger = new Logger(GeniusPayProvider.name);
  private readonly credential: GeniusPayCredential;

  constructor(
    secret: string,
    private readonly fetchImpl: typeof fetch = fetch,
    // GENIUSPAY_API_BASE_URL: only for tests (a local stand-in) — production uses the default.
    private readonly baseUrl: string = process.env.GENIUSPAY_API_BASE_URL ??
      GENIUSPAY_API_BASE_URL,
  ) {
    this.credential = parseGeniusPayCredential(secret);
  }

  /** A hosted checkout: the payer chooses Wave, Orange Money, MTN, Moov or a card on GeniusPay's
   *  page, then returns to `redirectUrl`. `invoiceId` travels as metadata, so the GeniusPay
   *  dashboard and every webhook name the KORVA invoice it settles. */
  async createPayment(input: {
    amount: number;
    currency: string;
    invoiceId: string;
    customerEmail?: string;
    redirectUrl?: string;
  }): Promise<PaymentProviderResult> {
    if (!input.redirectUrl) {
      throw new GeniusPayApiError(
        'A GeniusPay checkout needs the URL the payer returns to',
      );
    }
    const response = await this.request('/payments', 'POST', {
      amount: Math.round(input.amount),
      currency: input.currency,
      description: `KORVA ${input.invoiceId}`,
      ...(input.customerEmail
        ? { customer: { email: input.customerEmail } }
        : {}),
      success_url: input.redirectUrl,
      error_url: input.redirectUrl,
      metadata: { korva_invoice_id: input.invoiceId },
    });
    const data = isRecord(response.data) ? response.data : undefined;
    const reference = data?.reference;
    const checkoutUrl = data?.checkout_url ?? data?.payment_url;
    if (
      typeof reference !== 'string' ||
      !reference ||
      typeof checkoutUrl !== 'string' ||
      !checkoutUrl
    ) {
      throw new GeniusPayApiError(
        'GeniusPay did not return a reference and a checkout URL for this payment',
        undefined,
        response,
      );
    }
    return { providerReference: reference, status: 'pending', checkoutUrl };
  }

  /** The status is always read from GeniusPay itself — never taken from a webhook's body. */
  async verifyPayment(
    providerReference: string,
  ): Promise<PaymentProviderResult> {
    const response = await this.request(
      `/payments/${encodeURIComponent(providerReference)}`,
      'GET',
    );
    const data = isRecord(response.data) ? response.data : undefined;
    const status = data?.status;
    if (typeof status !== 'string') {
      throw new GeniusPayApiError(
        `GeniusPay response for "${providerReference}" has no payment status`,
        undefined,
        response,
      );
    }
    const fees = Number(data?.fees);
    const amount = Number(data?.amount);
    const currency = data?.currency;
    return {
      providerReference,
      status: mapGeniusPayStatus(status),
      ...(Number.isFinite(fees) && fees >= 0 ? { providerFee: fees } : {}),
      // GeniusPay settles in XOF whatever the order's currency: `amount` and `fees` are then in
      // XOF ("amount":610.7,"currency":"XOF","fees":115.28 for a 1 EUR order).
      ...(Number.isFinite(amount) && amount > 0 && typeof currency === 'string'
        ? { providerAmount: amount, providerCurrency: currency.toUpperCase() }
        : {}),
    };
  }

  async getPaymentStatus(providerReference: string): Promise<PaymentStatus> {
    return (await this.verifyPayment(providerReference)).status;
  }

  /** GeniusPay documents no refund endpoint: a typed 422 telling staff where to do it. */
  refundPayment(providerReference: string): Promise<PaymentProviderResult> {
    return Promise.reject(
      new UnprocessableEntityException({
        code: 'PAYMENT_PROVIDER_REFUND_UNSUPPORTED',
        message: `GeniusPay offers no refund API: refund payment "${providerReference}" from the GeniusPay dashboard`,
      }),
    );
  }

  /**
   * POST /payouts (https://pay.genius.ci/docs/payout-api): from the GeniusPay wallet named by
   * GENIUSPAY_PAYOUT_WALLET_ID to a mobile money account. `reference` doubles as GeniusPay's
   * `idempotency_key`, so a retried request never pays twice. Their payout page documents a
   * Bearer token while the payment API uses X-API-Key/X-API-Secret: both are sent.
   */
  async createPayout(input: PayoutRequest): Promise<PayoutResult> {
    const walletId = process.env.GENIUSPAY_PAYOUT_WALLET_ID;
    if (!walletId) {
      throw new GeniusPayApiError(
        'GENIUSPAY_PAYOUT_WALLET_ID is not set — the GeniusPay wallet withdrawals are paid from',
      );
    }
    const response = await this.request('/payouts', 'POST', {
      wallet_id: walletId,
      amount: Math.round(input.amount),
      currency: input.currency,
      description: input.description.slice(0, 250),
      idempotency_key: input.reference,
      metadata: { korva_payout_id: input.reference },
      recipient: {
        name: input.destination.holderName,
        phone: input.destination.account,
      },
      destination: {
        type: 'mobile_money',
        provider: input.destination.provider,
        account: input.destination.account,
      },
    });
    return toPayoutResult(response);
  }

  async getPayout(providerReference: string): Promise<PayoutResult> {
    return toPayoutResult(
      await this.request(
        `/payouts/${encodeURIComponent(providerReference)}`,
        'GET',
      ),
    );
  }

  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    try {
      const response = await this.request('/account', 'GET');
      return response.success === false
        ? {
            ok: false,
            message: response.message ?? 'GeniusPay rejected the request',
          }
        : { ok: true };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : 'Unknown GeniusPay error',
      };
    }
  }

  private async request(
    path: string,
    method: 'GET' | 'POST',
    body?: Record<string, unknown>,
  ): Promise<GeniusPayEnvelope> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.credential.apiSecret}`,
          'X-API-Key': this.credential.apiKey,
          'X-API-Secret': this.credential.apiSecret,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(GENIUSPAY_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new GeniusPayApiError(
        `GeniusPay request ${method} ${path} got no response: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        undefined,
        true,
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    if (!response.ok) {
      // Never the request: it carries no secret, but the response may echo customer data.
      this.logger.error(
        `GeniusPay ${method} ${path} answered ${response.status}`,
      );
      // GeniusPay's own words — e.g. INVALID_API_KEY "The provided API key is invalid." — tell
      // the operator what to fix far better than a status code.
      const error =
        isRecord(payload) && isRecord(payload.error)
          ? payload.error
          : undefined;
      const detail =
        error && typeof error.message === 'string'
          ? ` — ${typeof error.code === 'string' ? `${error.code}: ` : ''}${error.message}`
          : '';
      throw new GeniusPayApiError(
        `GeniusPay ${method} ${path} answered ${response.status}${detail}`,
        response.status,
        payload,
      );
    }
    return isRecord(payload) ? payload : {};
  }
}

/** GeniusPay's payout statuses: "pending" and "completed" in its examples, "failed" as an event;
 *  anything else still in flight reads as pending, and the sweep asks again. */
function toPayoutResult(response: GeniusPayEnvelope): PayoutResult {
  const data = isRecord(response.data)
    ? isRecord(response.data.payout)
      ? response.data.payout
      : response.data
    : undefined;
  const reference = data?.reference;
  if (typeof reference !== 'string' || !reference) {
    throw new GeniusPayApiError(
      'GeniusPay did not return a payout reference',
      undefined,
      response,
    );
  }
  const raw = typeof data?.status === 'string' ? data.status : 'pending';
  const status =
    raw === 'completed' || raw === 'success'
      ? 'completed'
      : raw === 'failed' || raw === 'cancelled' || raw === 'rejected'
        ? 'failed'
        : 'pending';
  const fee = Number(data?.fees);
  const reason = data?.failure_reason ?? data?.message;
  return {
    providerReference: reference,
    status,
    ...(Number.isFinite(fee) && fee >= 0 ? { fee } : {}),
    ...(status === 'failed' && typeof reason === 'string'
      ? { failureReason: reason }
      : {}),
  };
}
