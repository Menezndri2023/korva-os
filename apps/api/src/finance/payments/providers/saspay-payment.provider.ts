import { Logger, UnprocessableEntityException } from '@nestjs/common';
import type { PaymentStatus } from '@korva/types';
import type {
  PaymentProvider,
  PaymentProviderResult,
  PayoutRequest,
  PayoutResult,
} from './payment-provider.interface';

/**
 * SasPay (saspay.me, operated by Payix LLC) — mobile money in 18 African countries plus cards,
 * behind ONE hosted checkout page, and an API for withdrawals. Reference: docs.saspay.me and its
 * OpenAPI file (read 2026-11-21):
 *
 *   POST /checkout-sessions/                  hosted page; the payer picks the network
 *   GET  /checkout-sessions/{id}/status/      PENDING | PAID | EXPIRED | CANCELLED + transaction
 *   GET  /payments/{transaction_id}/verify/   re-checked at the gateway; fees and net amount
 *   POST /payouts/initialize/                 to a mobile money number (Idempotency-Key)
 *   GET  /payouts/{id}/verify/
 *   GET  /merchant-balances/                  used by testConnection
 *   Authorization: Bearer sk_live_… | sk_test_…, every answer wrapped in {success, data, code}.
 *
 * THE HOST DECIDES THE ENVIRONMENT, NOT THE KEY. SasPay's support confirmed that an sk_test_ key
 * sent to api.saspay.me moves real money (a third-party card test, 2026-11-01). So the key and
 * the host must agree — sk_live_ ↔ api.saspay.me, sk_test_ ↔ sandbox-api.saspay.me — or the
 * adapter refuses to start (assertKeyMatchesHost). Nobody can then "test" on production by
 * mistake.
 *
 * KORVA's providerReference is the CHECKOUT SESSION id: it is the only id known when the payer
 * is sent away. The transaction behind it appears once they pay, and is read through the
 * session's status.
 *
 * Fees: sessions are created with fee_charge_mode DEDUCTED — the customer pays the price shown,
 * and SasPay's fee comes off what KORVA receives, exactly like GeniusPay, so the Solde KORVA books
 * it against the business. SasPay only honours the field when "Autoriser le choix du mode de
 * frais par l'API" is on in its dashboard; whatever happens, providerFee is read from what SasPay
 * says it kept (requested − net), never assumed.
 *
 * Cards are charged in USD only (Stripe / FeexPay behind SasPay): a card payment for an XOF
 * order comes back in USD, and provider-fees.ts converts its fee at SasPay's own rate.
 *
 * Not offered by SasPay's API, so not offered here: refunds (sent by hand, refundsManually) and
 * saved payment methods (no chargeRecurring — plan renewals fall back to a payment link).
 */
export const SASPAY_LIVE_BASE_URL = 'https://api.saspay.me/api/v1';
export const SASPAY_SANDBOX_BASE_URL = 'https://sandbox-api.saspay.me/api/v1';
const SASPAY_REQUEST_TIMEOUT_MS = 20_000;
/** How far back the webhook looks for the session a transaction belongs to (pages of 100). */
const SESSION_LOOKUP_PAGES = 3;

export class SasPayApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: unknown,
    /** No HTTP answer: KORVA cannot know whether SasPay acted — see AmbiguousProviderErrorMarker. */
    public readonly ambiguous?: true,
  ) {
    super(message);
    this.name = 'SasPayApiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The secret is one key; JSON {"apiKey":"sk_…"} is accepted too, like the other adapters. */
export function parseSasPayCredential(secret: string): string {
  let key = secret.trim();
  if (key.startsWith('{')) {
    try {
      const parsed = JSON.parse(key) as Record<string, unknown>;
      key = typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : '';
    } catch {
      key = '';
    }
  }
  if (!/^sk_(live|test)_[A-Za-z0-9]+$/.test(key)) {
    throw new SasPayApiError(
      'SasPay credential must be one secret key, sk_live_… or sk_test_…',
    );
  }
  return key;
}

/**
 * sk_live_ only on api.saspay.me, sk_test_ only on sandbox-api.saspay.me. Any other host (a local
 * stand-in in tests) accepts a test key only, so a live key never leaves for an unknown address.
 */
export function assertKeyMatchesHost(key: string, baseUrl: string): void {
  const host = new URL(baseUrl).host;
  const live = key.startsWith('sk_live_');
  if ((host === 'api.saspay.me') !== live) {
    throw new SasPayApiError(
      live
        ? `A live SasPay key (sk_live_…) can only be sent to api.saspay.me, not ${host}`
        : `A SasPay test key (sk_test_…) moves REAL money on api.saspay.me — use SASPAY_API_BASE_URL=${SASPAY_SANDBOX_BASE_URL}`,
    );
  }
}

/** The base URL that matches the key, unless SASPAY_API_BASE_URL says otherwise. */
export function defaultSasPayBaseUrl(key: string): string {
  return (
    process.env.SASPAY_API_BASE_URL ??
    (key.startsWith('sk_live_')
      ? SASPAY_LIVE_BASE_URL
      : SASPAY_SANDBOX_BASE_URL)
  );
}

/** SasPay amounts are decimal strings ("2500.00"), never floats. */
export function toSasPayAmount(amount: number, currency: string): string {
  const whole = ['XOF', 'XAF', 'GNF', 'RWF', 'UGX'].includes(
    currency.toUpperCase(),
  );
  return (whole ? Math.round(amount) : Math.round(amount * 100) / 100).toFixed(
    2,
  );
}

/**
 * A session and its transaction together. The session can stay PENDING while a first attempt
 * FAILED — the payer sees "Réessayer" on SasPay's page — so a failed transaction under an open
 * session is still pending; only the session closing (EXPIRED / CANCELLED) fails the payment.
 */
export function mapSasPaySessionStatus(
  sessionStatus: string,
  transactionStatus: string | null,
): PaymentStatus {
  if (transactionStatus === 'SUCCESS' || sessionStatus === 'PAID') {
    return 'completed';
  }
  switch (sessionStatus) {
    case 'PENDING':
      return transactionStatus === 'PENDING' ? 'processing' : 'pending';
    case 'EXPIRED':
    case 'CANCELLED':
      return 'failed';
    default:
      throw new SasPayApiError(
        `Unrecognized SasPay checkout session status "${sessionStatus}"`,
      );
  }
}

/**
 * KORVA's payout destinations → SasPay network codes. SasPay holds one wallet per COUNTRY and
 * refuses a payout whose currency does not match the beneficiary's country, so the country is
 * part of the code (wave_ci, orange_sn…). Only networks SasPay lists as active.
 */
const PAYOUT_NETWORKS: Record<string, Record<string, string>> = {
  CI: {
    wave: 'wave_ci',
    orange_money: 'orange_ci',
    mtn_money: 'mtn_ci',
    moov_money: 'moov_ci',
  },
  SN: { wave: 'wave_sn', orange_money: 'orange_sn' },
  BJ: { mtn_money: 'mtn_bj', moov_money: 'moov_bj' },
  TG: { moov_money: 'moov_tg' },
  BF: { orange_money: 'orange_bf', moov_money: 'moov_bf' },
  ML: { orange_money: 'orange_ml', moov_money: 'moov_ml' },
  CM: { mtn_money: 'mtn_cm', orange_money: 'orange_cm' },
};
const COUNTRY_CURRENCY: Record<string, string> = {
  CI: 'XOF',
  SN: 'XOF',
  BJ: 'XOF',
  TG: 'XOF',
  BF: 'XOF',
  ML: 'XOF',
  CM: 'XAF',
};
const DIALING_CODES: Record<string, string> = {
  '225': 'CI',
  '221': 'SN',
  '229': 'BJ',
  '228': 'TG',
  '226': 'BF',
  '223': 'ML',
  '237': 'CM',
};

/** The country of a mobile money number written in international format ("+225 07 …"). */
export function countryOfNumber(account: string): string | undefined {
  const digits = account.replace(/[^\d+]/g, '');
  if (!digits.startsWith('+')) return undefined;
  return DIALING_CODES[digits.slice(1, 4)];
}

export function sasPayPayoutRoute(destination: {
  provider: string;
  account: string;
}): { country: string; method: string; currency: string; msisdn: string } {
  const country = countryOfNumber(destination.account);
  const method = country
    ? PAYOUT_NETWORKS[country]?.[destination.provider]
    : undefined;
  const currency = country ? COUNTRY_CURRENCY[country] : undefined;
  if (!country || !method || !currency) {
    throw new SasPayApiError(
      `SasPay cannot pay ${destination.provider} on ${destination.account}: number in international format (+225…) and a network SasPay serves in that country are required`,
    );
  }
  return {
    country,
    method,
    currency,
    msisdn: destination.account.replace(/[^\d+]/g, ''),
  };
}

export class SasPayProvider implements PaymentProvider {
  readonly name = 'saspay';
  /** XOF and XAF are SasPay's home currencies; USD is what cards are charged in. Other mobile
   *  money currencies (GHS, KES…) exist at SasPay but KORVA sells in none of them yet. */
  readonly supportedCurrencies = ['XOF', 'XAF', 'USD'] as const;
  /** No refund endpoint: PaymentsService routes refunds to KORVA's administration. */
  readonly refundsManually = true;
  private readonly logger = new Logger(SasPayProvider.name);
  private readonly key: string;
  private readonly baseUrl: string;

  constructor(
    secret: string,
    private readonly fetchImpl: typeof fetch = fetch,
    baseUrl?: string,
  ) {
    this.key = parseSasPayCredential(secret);
    this.baseUrl = (baseUrl ?? defaultSasPayBaseUrl(this.key)).replace(
      /\/+$/,
      '',
    );
    assertKeyMatchesHost(this.key, this.baseUrl);
  }

  async createPayment(input: {
    amount: number;
    currency: string;
    invoiceId: string;
    customerEmail?: string;
    redirectUrl?: string;
  }): Promise<PaymentProviderResult> {
    if (!input.redirectUrl) {
      throw new SasPayApiError(
        'A SasPay checkout needs the URL the payer returns to',
      );
    }
    // SasPay requires an e-mail and a name; a counter sale has neither (nobody typed one), so
    // KORVA's own sender address stands in — SasPay sends the customer nothing at it.
    const email =
      input.customerEmail ?? process.env.EMAIL_FROM ?? 'no-reply@korva.app';
    const response = await this.request('/checkout-sessions/', 'POST', {
      amount: toSasPayAmount(input.amount, input.currency),
      currency: input.currency.toUpperCase(),
      description: `KORVA ${input.invoiceId}`,
      customer_email: email,
      customer_name:
        input.customerEmail?.split('@')[0]?.slice(0, 80) || 'Client',
      return_url: input.redirectUrl,
      fee_charge_mode: 'DEDUCTED',
      metadata: { korva_invoice_id: input.invoiceId },
      ...(process.env.SASPAY_DEFAULT_COUNTRY
        ? { country: process.env.SASPAY_DEFAULT_COUNTRY }
        : {}),
    });
    const data = isRecord(response.data) ? response.data : undefined;
    const id = data?.id;
    const checkoutUrl = data?.checkout_url;
    if (
      typeof id !== 'string' ||
      !id ||
      typeof checkoutUrl !== 'string' ||
      !checkoutUrl
    ) {
      throw new SasPayApiError(
        'SasPay did not return a session id and a checkout URL for this payment',
        undefined,
        response,
      );
    }
    return { providerReference: id, status: 'pending', checkoutUrl };
  }

  /** Always read from SasPay — the session, then its transaction (re-checked at the gateway). */
  async verifyPayment(
    providerReference: string,
  ): Promise<PaymentProviderResult> {
    const response = await this.request(
      `/checkout-sessions/${encodeURIComponent(providerReference)}/status/`,
      'GET',
    );
    const data = isRecord(response.data) ? response.data : undefined;
    const sessionStatus = data?.status;
    if (typeof sessionStatus !== 'string') {
      throw new SasPayApiError(
        `SasPay response for session "${providerReference}" has no status`,
        undefined,
        response,
      );
    }
    const transactionId =
      typeof data?.transaction_id === 'string' && data.transaction_id
        ? data.transaction_id
        : undefined;
    let transactionStatus =
      typeof data?.transaction_status === 'string'
        ? data.transaction_status
        : null;
    let settlement: Partial<PaymentProviderResult> = {};
    if (transactionId) {
      const verified = await this.request(
        `/payments/${encodeURIComponent(transactionId)}/verify/`,
        'GET',
      );
      const transaction = isRecord(verified.data) ? verified.data : undefined;
      if (typeof transaction?.status === 'string') {
        transactionStatus = transaction.status;
      }
      settlement = settlementOf(transaction);
    }
    const status = mapSasPaySessionStatus(sessionStatus, transactionStatus);
    return {
      providerReference,
      status,
      ...(status === 'completed' ? settlement : {}),
    };
  }

  async getPaymentStatus(providerReference: string): Promise<PaymentStatus> {
    return (await this.verifyPayment(providerReference)).status;
  }

  refundPayment(providerReference: string): Promise<PaymentProviderResult> {
    return Promise.reject(
      new UnprocessableEntityException({
        code: 'PAYMENT_PROVIDER_REFUND_UNSUPPORTED',
        message: `SasPay offers no refund API: refund payment "${providerReference}" by hand`,
      }),
    );
  }

  /**
   * POST /payouts/initialize/ from SasPay's wallet for the beneficiary's country. `reference`
   * (KORVA's payout id) is the Idempotency-Key, so the sweep re-sending after a timeout gets the
   * first answer back instead of paying twice — which is why the body must stay byte-identical
   * between retries (a different body under the same key is a 409).
   *
   * Needs, on SasPay's side: payouts enabled for the account (else 403 payout_not_enabled) and
   * the server's IP on the whitelist (else 403 ip_not_whitelisted).
   */
  async createPayout(input: PayoutRequest): Promise<PayoutResult> {
    const route = sasPayPayoutRoute(input.destination);
    if (route.currency !== input.currency.toUpperCase()) {
      throw new SasPayApiError(
        `SasPay pays ${route.country} numbers in ${route.currency} only, not ${input.currency}`,
      );
    }
    const response = await this.request(
      '/payouts/initialize/',
      'POST',
      {
        amount: toSasPayAmount(input.amount, input.currency),
        currency: route.currency,
        country: route.country,
        method: route.method,
        description: input.description.slice(0, 250),
        customer: {
          phone: route.msisdn,
          ...nameParts(input.destination.holderName),
        },
        recipient: { msisdn: route.msisdn },
        fee_charge_mode: 'DEDUCTED',
        metadata: { korva_payout_id: input.reference },
      },
      input.reference,
    );
    const data = isRecord(response.data) ? response.data : undefined;
    const id = data?.id;
    if (typeof id !== 'string' || !id) {
      throw new SasPayApiError(
        'SasPay did not return a payout id',
        undefined,
        response,
      );
    }
    // The initialize answer carries no status: ask straight away, it is usually still PENDING.
    try {
      return await this.getPayout(id);
    } catch {
      return { providerReference: id, status: 'pending' };
    }
  }

  async getPayout(providerReference: string): Promise<PayoutResult> {
    const response = await this.request(
      `/payouts/${encodeURIComponent(providerReference)}/verify/`,
      'GET',
    );
    const data = isRecord(response.data) ? response.data : undefined;
    const raw = typeof data?.status === 'string' ? data.status : 'PENDING';
    const status =
      raw === 'SUCCESS'
        ? 'completed'
        : raw === 'FAILED' || raw === 'CANCELLED'
          ? 'failed'
          : 'pending';
    const requested = Number(data?.requested_amount);
    const net = Number(data?.net_amount);
    const fee =
      Number.isFinite(requested) && Number.isFinite(net) && requested >= net
        ? Math.round((requested - net) * 100) / 100
        : undefined;
    return {
      providerReference,
      status,
      ...(fee !== undefined ? { fee } : {}),
      ...(status === 'failed'
        ? { failureReason: `SasPay payout ${raw.toLowerCase()}` }
        : {}),
    };
  }

  /**
   * The webhook names a TRANSACTION; KORVA stored the SESSION. The most recent paid sessions are
   * searched for the one carrying that transaction. Not found → undefined, and the reconciliation
   * sweep settles the payment anyway.
   */
  async findSessionIdForTransaction(
    transactionId: string,
  ): Promise<string | undefined> {
    for (let page = 1; page <= SESSION_LOOKUP_PAGES; page += 1) {
      const response = await this.request(
        `/checkout-sessions/?page=${page}&page_size=100`,
        'GET',
      );
      const data = isRecord(response.data) ? response.data : undefined;
      const results = Array.isArray(data?.results) ? data.results : [];
      for (const session of results) {
        if (
          isRecord(session) &&
          session.transaction === transactionId &&
          typeof session.id === 'string'
        ) {
          return session.id;
        }
      }
      if (!data?.next) return undefined;
    }
    return undefined;
  }

  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    try {
      await this.request('/merchant-balances/', 'GET');
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : 'Unknown SasPay error',
      };
    }
  }

  private async request(
    path: string,
    method: 'GET' | 'POST',
    body?: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<{ success?: boolean; data?: unknown }> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.key}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(SASPAY_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new SasPayApiError(
        `SasPay request ${method} ${path} got no response: ${error instanceof Error ? error.message : String(error)}`,
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
    if (!response.ok || (isRecord(payload) && payload.success === false)) {
      this.logger.error(`SasPay ${method} ${path} answered ${response.status}`);
      throw new SasPayApiError(
        `SasPay ${method} ${path} answered ${response.status}${errorDetail(payload)}`,
        response.status,
        payload,
      );
    }
    return isRecord(payload) ? payload : {};
  }
}

/** SasPay's words — "ip_not_whitelisted: IP non autorisée…" tells the operator what to fix. A
 *  validation error is a map of fields to messages instead of {message, code}. */
function errorDetail(payload: unknown): string {
  if (!isRecord(payload) || !isRecord(payload.error)) return '';
  const error = payload.error;
  if (typeof error.message === 'string') {
    return ` — ${typeof error.code === 'string' ? `${error.code}: ` : ''}${error.message}`;
  }
  const fields = Object.entries(error)
    .map(
      ([field, messages]) =>
        `${field}: ${Array.isArray(messages) ? messages.join(' ') : String(messages)}`,
    )
    .join('; ');
  return fields ? ` — ${fields}` : '';
}

/** What SasPay kept, from the verified transaction: requested − net, in its currency (USD for
 *  a card, whatever the order's currency). */
function settlementOf(
  transaction: Record<string, unknown> | undefined,
): Partial<PaymentProviderResult> {
  if (!transaction) return {};
  const requested = Number(transaction.requested_amount);
  const net = Number(transaction.net_amount);
  const currency = transaction.currency;
  if (
    !Number.isFinite(requested) ||
    requested <= 0 ||
    !Number.isFinite(net) ||
    typeof currency !== 'string'
  ) {
    return {};
  }
  return {
    providerFee: Math.max(0, Math.round((requested - net) * 100) / 100),
    providerAmount: requested,
    providerCurrency: currency.toUpperCase(),
  };
}

function nameParts(holderName: string): {
  first_name?: string;
  last_name?: string;
} {
  const parts = holderName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  return parts.length === 1
    ? { first_name: parts[0] }
    : { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}
