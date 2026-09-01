import { Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { PaymentStatus } from '@korva/types';
import type {
  PaymentProvider,
  PaymentProviderResult,
} from './payment-provider.interface';

/**
 * Real adapter for Flutterwave's v3 REST API (Merchant-of-Record, Côte d'Ivoire — see
 * docs/decisions/psp-provider.md and docs/architecture/integrations-platform.md §4/§9).
 *
 * ## Why v3, not v4
 * Flutterwave now also publishes a newer "v4" API (developer.flutterwave.com/docs/quickstart,
 * base URL `https://developersandbox-api.flutterwave.com`) authenticated via OAuth2
 * client-credentials (an access token exchanged from a client id/secret, valid ~10 minutes) —
 * fetched and read directly as part of this lot's research, see the implementing agent's final
 * report for the exact URLs. v4's own docs, as currently published, describe its Payout
 * Subaccount ("PSA") feature as an NGN-wallet-specific construct (fields: `account_name`,
 * `email`, `country`; response: `account_reference`, `barter_id`) — a different concept from the
 * `business_name`/`account_bank`/`split_type`/`split_value` split-payment Subaccount this adapter
 * needs for XOF/Côte d'Ivoire Merchant-of-Record settlement, and v4 does not document an
 * equivalent for that yet. v3 (`https://api.flutterwave.com/v3`) remains live and fully
 * documented (developer.flutterwave.com/v3.0.0/*), uses a single static secret key via
 * `Authorization: Bearer <secret key>` (matching this interface's "constructor takes an API key"
 * contract and `ResendEmailProvider`'s constructor-injection style — no OAuth token exchange/
 * caching to build), and is what `docs/decisions/psp-provider.md`'s own citations and
 * `payment-provider.interface.ts`'s `createPayoutDestination` doc comment ("Flutterwave's Create
 * Subaccount API") were already written against. This adapter targets v3 deliberately, not by
 * oversight — see this lot's final report for the full list of doc URLs fetched confirming this.
 *
 * ## What was verified against live docs (fetched 2026-08-26) vs. what is assumed
 * Endpoints, request/response field names, and the webhook scheme below are all taken directly
 * from Flutterwave's current v3 reference docs (URLs cited on each method). No live sandbox call
 * was ever made — no credentials exist in this environment — so nothing here is "proven against
 * sandbox," only "matches what the docs currently say."
 */

const FLUTTERWAVE_API_BASE_URL = 'https://api.flutterwave.com/v3';
const FLUTTERWAVE_REQUEST_TIMEOUT_MS = 15_000;

/** Thrown for every Flutterwave failure mode this adapter can detect: non-2xx response, non-JSON
 * body, a JSON body missing the top-level `status` field Flutterwave always documents, or a
 * transaction/refund status value outside the set the docs enumerate. Never thrown for a
 * legitimately-reported business failure that still has a well-formed response (e.g. Flutterwave
 * itself is free to report `data.status: "failed"` for a declined card — that is a normal,
 * typed `PaymentProviderResult`, not an exception). */
export class FlutterwaveApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: unknown,
    /**
     * Stage 2.6 — set (to `true`) ONLY for the network-error/timeout branch of `request()` below,
     * where no HTTP response was ever received at all: Flutterwave may have genuinely processed
     * the request despite the caller never finding out. Every other FlutterwaveApiError (non-2xx,
     * malformed body, missing `status` field, ...) represents a definite response FROM
     * Flutterwave and is never ambiguous — this stays `undefined` for those. See
     * payment-provider.interface.ts's isAmbiguousProviderError for how PaymentsService uses this.
     */
    public readonly ambiguous?: true,
    /**
     * Stage 2.12 — a correlation reference `createPayment()` had ALREADY generated and sent to
     * Flutterwave (the merchant `tx_ref`) before the request() call that threw this error — set
     * ONLY by createPayment()'s own catch-and-rethrow around its request() call (see there), so
     * this is a positive fact about a specific, already-computed local value, never a guess.
     * PURELY a correlation identifier for future lookup — see
     * payment-provider.interface.ts's getAmbiguousErrorProviderReference for the full reasoning
     * on why this is never evidence of provider execution. `undefined` for every other
     * FlutterwaveApiError (verifyPayment/refundPayment/createPayoutDestination failures, or any
     * createPayment failure that isn't this specific network-error branch), since only
     * createPayment() ever has a value here to attach.
     */
    public readonly generatedReference?: string,
  ) {
    super(message);
    this.name = 'FlutterwaveApiError';
  }
}

interface FlutterwaveEnvelope {
  status: string;
  message?: string;
  data?: unknown;
}

/**
 * Per-payment split-settlement override for a tenant's already-registered payout destination
 * (see `createPayoutDestination` below). Field names/semantics per
 * developer.flutterwave.com/v3.0.0/docs/split-payments.md (fetched 2026-08-26): the `subaccounts`
 * array on a Standard Payment request is "an array of objects, each containing the ID of the
 * subaccount," with optional per-transaction overrides of the subaccount's own default split.
 */
export interface FlutterwavePayoutSplit {
  /** The Flutterwave `subaccount_id` returned by this adapter's own `createPayoutDestination`. */
  subaccountId: string;
  transactionChargeType?: 'flat_subaccount' | 'flat' | 'percentage';
  transactionCharge?: number;
  transactionSplitRatio?: number;
}

/**
 * `PaymentProvider.createPayment`'s interface-level `customerEmail`/`redirectUrl` are optional
 * (a manual/staff-recorded payment has neither); this adapter accepts a wider object making both
 * REQUIRED (TypeScript's bivariant method-parameter checking allows this while still satisfying
 * the interface) plus `payoutDestination`, which the base interface has no equivalent for at all:
 *
 * - `customerEmail` is a REQUIRED field on Flutterwave's own API (`customer.email`) — the real
 *   caller (a customer-initiated online payment, resolving a provider via
 *   PaymentProviderResolverService) must resolve it from the paying contact before calling
 *   `createPayment`. There is no sane fallback value, so this adapter treats it as required
 *   rather than silently sending an empty string to Flutterwave.
 * - `redirectUrl` is technically optional on Flutterwave's side but is required by this adapter:
 *   a hosted checkout link with nowhere to send the customer back to is not a usable real
 *   integration.
 * - `payoutDestination` is present only when the invoice's tenant/organization has a configured
 *   Merchant-of-Record payout destination (docs/architecture/integrations-platform.md §4 "Split
 *   settlement") — i.e., `IntegrationAccount.metadata.subaccountId`, as produced by this adapter's
 *   own `createPayoutDestination`. Wiring that lookup into `PaymentsService`/`InvoicesService` is
 *   explicitly out of scope for Stage 2; a caller that hasn't built that lookup yet simply omits
 *   this field and gets a non-split payment.
 */
export interface FlutterwaveCreatePaymentInput {
  amount: number;
  currency: string;
  invoiceId: string;
  customerEmail: string;
  customerName?: string;
  customerPhoneNumber?: string;
  redirectUrl: string;
  payoutDestination?: FlutterwavePayoutSplit;
}

/**
 * `PaymentProvider.createPayoutDestination`'s `payoutDetails` is intentionally untyped
 * (`Record<string, string>`) at the interface boundary. This adapter expects the keys Flutterwave's
 * real Create Subaccount API documents (developer.flutterwave.com/v3.0.0/reference/create-a-sub-account.md,
 * fetched 2026-08-26): `account_bank`, `account_number`, `business_name`, `country`, `split_type`
 * ("percentage" | "flat"), and `split_value` are the fields this adapter treats as required (the
 * minimum Flutterwave needs to create a working split subaccount); `business_email`,
 * `business_contact`, `business_contact_mobile`, and `business_mobile` are passed through
 * verbatim if present but not required by this adapter.
 */
const REQUIRED_PAYOUT_DESTINATION_FIELDS = [
  'account_bank',
  'account_number',
  'business_name',
  'country',
  'split_type',
  'split_value',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export class FlutterwaveProvider implements PaymentProvider {
  readonly name = 'flutterwave';
  private readonly logger = new Logger(FlutterwaveProvider.name);

  /**
   * @param secretKey Flutterwave secret key (`FLWSECK-...`), sent as `Authorization: Bearer
   * <secretKey>` on every request. Never read from `process.env`/`ConfigService` inside this
   * class — matching `ResendEmailProvider`'s constructor-injection style, the decrypted key is
   * handed in by whoever constructs this adapter (eventually `IntegrationsService`'s decrypt
   * path, per docs/architecture/integrations-platform.md §3, wired in Stage 2.2 —
   * PaymentProviderRegistry now decrypts and passes a real secret; this constructor still throws
   * if handed a falsy one anyway, as a second, independent fail-closed guard — this class must
   * never construct successfully with nothing to authenticate with, regardless of what the
   * registry does or doesn't check, since a future caller could construct this class directly).
   */
  constructor(private readonly secretKey: string) {
    if (!secretKey) {
      throw new FlutterwaveApiError(
        'FlutterwaveProvider requires a non-empty secret key — refusing to construct an adapter that would send Authorization: Bearer <empty>',
      );
    }
  }

  /**
   * Calls Flutterwave's Standard Payment / Checkout endpoint
   * (developer.flutterwave.com/v3.0.0/reference/checkout.md, fetched 2026-08-26):
   * `POST https://api.flutterwave.com/v3/payments`. On success Flutterwave returns only a hosted
   * checkout `data.link` — it does NOT return a usable transaction id at this point (Flutterwave's
   * own numeric transaction id is only assigned once the customer actually attempts payment, and
   * becomes known via the redirect callback or a webhook). Consequently, this adapter's
   * `providerReference` is always the merchant-generated `tx_ref`, never Flutterwave's numeric
   * id — `verifyPayment`/`getPaymentStatus`/`refundPayment` below are written around that same
   * `tx_ref` for exactly this reason.
   *
   * Per docs/architecture/integrations-platform.md §7 ("HTTP 200 ≠ paid"), a successful response
   * here only means a checkout link was created — status is always `'pending'`, never
   * `'completed'`. Completion is only ever asserted by `verifyPayment` or a verified webhook.
   * `checkoutUrl` on the result is that same `data.link` — the caller must redirect the payer
   * there to actually complete anything.
   */
  async createPayment(
    input: FlutterwaveCreatePaymentInput,
  ): Promise<PaymentProviderResult> {
    const txRef = `korva_${input.invoiceId}_${randomBytes(8).toString('hex')}`;

    const body: Record<string, unknown> = {
      tx_ref: txRef,
      amount: input.amount,
      currency: input.currency,
      redirect_url: input.redirectUrl,
      customer: {
        email: input.customerEmail,
        ...(input.customerName ? { name: input.customerName } : {}),
        ...(input.customerPhoneNumber
          ? { phonenumber: input.customerPhoneNumber }
          : {}),
      },
      customizations: { title: 'KORVA' },
    };

    if (input.payoutDestination) {
      body.subaccounts = [
        {
          id: input.payoutDestination.subaccountId,
          ...(input.payoutDestination.transactionChargeType
            ? {
                transaction_charge_type:
                  input.payoutDestination.transactionChargeType,
              }
            : {}),
          ...(input.payoutDestination.transactionCharge !== undefined
            ? { transaction_charge: input.payoutDestination.transactionCharge }
            : {}),
          ...(input.payoutDestination.transactionSplitRatio !== undefined
            ? {
                transaction_split_ratio:
                  input.payoutDestination.transactionSplitRatio,
              }
            : {}),
        },
      ];
    }

    // Stage 2.12 — `txRef` above was already generated and already sent to Flutterwave in `body`
    // by the time this call is made. Before this stage, ANY error thrown by request() (including
    // an ambiguous network timeout — no HTTP response ever received) discarded it entirely: the
    // caller (PaymentsService.create()) had no way to know what merchant reference was already
    // in flight. This catch re-throws the exact same error (same message/statusCode/
    // responseBody/ambiguous — the distinction request-error-handling depends on is completely
    // unchanged), only ADDING the already-known txRef as `generatedReference` so it is never
    // silently lost. This is pure evidence attachment: it never changes whether the error is
    // ambiguous, never changes what request() itself does, and is read only via the
    // provider-agnostic getAmbiguousErrorProviderReference() accessor — never assumed to mean
    // the payment was actually created.
    let response: FlutterwaveEnvelope;
    try {
      response = await this.request('/payments', 'POST', body);
    } catch (error) {
      if (error instanceof FlutterwaveApiError) {
        throw new FlutterwaveApiError(
          error.message,
          error.statusCode,
          error.responseBody,
          error.ambiguous,
          txRef,
        );
      }
      throw error;
    }
    const data = isRecord(response.data) ? response.data : undefined;
    const link = data?.link;
    if (response.status !== 'success' || typeof link !== 'string' || !link) {
      throw new FlutterwaveApiError(
        'Flutterwave did not return a checkout link for this payment',
        undefined,
        response,
      );
    }

    return { providerReference: txRef, status: 'pending', checkoutUrl: link };
  }

  /**
   * Calls Flutterwave's Verify Transaction by Reference endpoint
   * (developer.flutterwave.com/v3.0.0/reference/verify-transaction-with-tx_ref.md, fetched
   * 2026-08-26): `GET https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=<ref>`.
   * Uses the by-reference variant (not the by-numeric-id `verify-transaction.md` endpoint)
   * because, per `createPayment`'s own doc comment above, `providerReference` here is always the
   * merchant `tx_ref`, never Flutterwave's numeric id.
   */
  async verifyPayment(
    providerReference: string,
  ): Promise<PaymentProviderResult> {
    const response = await this.request(
      `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(providerReference)}`,
      'GET',
    );
    return this.toPaymentResult(providerReference, response);
  }

  async getPaymentStatus(providerReference: string): Promise<PaymentStatus> {
    const result = await this.verifyPayment(providerReference);
    return result.status;
  }

  /**
   * Flutterwave's Refund endpoint (developer.flutterwave.com/v3.0.0/reference/transaction-refund.md,
   * fetched 2026-08-26) is `POST https://api.flutterwave.com/v3/transactions/{id}/refund`, where
   * `{id}` is Flutterwave's own NUMERIC transaction id — not the `tx_ref` this adapter otherwise
   * uses everywhere else. Since this adapter never receives that numeric id directly (see
   * `createPayment`'s doc comment), refunding requires first resolving it via the same
   * verify-by-reference call `verifyPayment` uses, reading back `data.id`, and only then calling
   * the refund endpoint — a real two-step flow, not a simplification.
   */
  /**
   * Stage 2.7A — `localReferenceForReconciliation`, when given, is sent as Flutterwave's own
   * documented `comments` field on the refund-creation request (a free-text "Custom description
   * for the refund" — developer.flutterwave.com/v3.0.0/reference/transaction-refund.md, fetched
   * 2026-08-27). This is a durable breadcrumb only: Flutterwave's "Fetch a refunded transaction"
   * / "Fetch multiple refunded transactions" endpoints
   * (developer.flutterwave.com/v3.0.0/reference/get-transaction-refunds.md and
   * .../get-all-refunds.md, both fetched 2026-08-27) are keyed by the SAME numeric transaction id
   * this method already resolves via verify_by_reference above, and their documented response
   * items echo back this same `comment` field — meaning a future reconciliation pass COULD match
   * a specific KORVA Refund document against Flutterwave's own refund record by this value. That
   * lookup/match/finalize mechanism is deliberately NOT implemented here (Stage 2.7A's own
   * mandate: this capability is documented, never verified against a live/sandbox call — the
   * real response's exact status-string vocabulary, e.g. whether "completed-mpgs"-style
   * provider-suffixed statuses appear, cannot be safely trusted for an automatic financial
   * decision without that verification). This method only ever captures the breadcrumb; nothing
   * reads it back yet.
   */
  async refundPayment(
    providerReference: string,
    amount: number,
    localReferenceForReconciliation?: string,
  ): Promise<PaymentProviderResult> {
    const verifyResponse = await this.request(
      `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(providerReference)}`,
      'GET',
    );
    const verifyData = isRecord(verifyResponse.data)
      ? verifyResponse.data
      : undefined;
    const transactionId = verifyData?.id;
    if (
      verifyResponse.status !== 'success' ||
      (typeof transactionId !== 'string' && typeof transactionId !== 'number')
    ) {
      throw new FlutterwaveApiError(
        `Could not resolve a Flutterwave transaction id for reference "${providerReference}" before refunding`,
        undefined,
        verifyResponse,
      );
    }

    const refundResponse = await this.request(
      `/transactions/${transactionId}/refund`,
      'POST',
      {
        amount,
        ...(localReferenceForReconciliation
          ? { comments: localReferenceForReconciliation }
          : {}),
      },
    );
    if (refundResponse.status !== 'success') {
      throw new FlutterwaveApiError(
        `Flutterwave refund request failed for reference "${providerReference}"`,
        undefined,
        refundResponse,
      );
    }

    // Stage 2.12 — purely defensive, additive extraction. Stage 2.7A/2.7B research confirmed
    // Flutterwave's LIST-refunds response schema documents `id` (numeric) and `flw_ref` (string)
    // as two distinct fields on a refund record, but this CREATE-refund response's own schema was
    // never actually confirmed against official docs — so both reads are type-guarded and each
    // field is included only when actually present with the expected type. Never throws on
    // absence, never invents a value, never required for the refund to be considered successful:
    // the success/failure decision above is completely unchanged and does not depend on these.
    const refundData = isRecord(refundResponse.data)
      ? refundResponse.data
      : undefined;
    const rawRefundId = refundData?.id;
    const providerRefundId =
      typeof rawRefundId === 'string'
        ? rawRefundId
        : typeof rawRefundId === 'number'
          ? String(rawRefundId)
          : undefined;
    const rawRefundReference = refundData?.flw_ref;
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
   * Calls Flutterwave's Create Subaccount endpoint
   * (developer.flutterwave.com/v3.0.0/reference/create-a-sub-account.md, fetched 2026-08-26):
   * `POST https://api.flutterwave.com/v3/subaccounts`. See `REQUIRED_PAYOUT_DESTINATION_FIELDS`'s
   * doc comment above for exactly which `payoutDetails` keys this adapter expects and why.
   */
  async createPayoutDestination(input: {
    organizationId: string;
    payoutDetails: Record<string, string>;
  }): Promise<{ destinationRef: string }> {
    for (const field of REQUIRED_PAYOUT_DESTINATION_FIELDS) {
      if (!input.payoutDetails[field]) {
        throw new FlutterwaveApiError(
          `Missing required Flutterwave subaccount field "${field}" for organization "${input.organizationId}"`,
        );
      }
    }

    const splitValue = Number(input.payoutDetails.split_value);
    if (!Number.isFinite(splitValue)) {
      throw new FlutterwaveApiError(
        `Flutterwave subaccount field "split_value" must be numeric, got "${input.payoutDetails.split_value}"`,
      );
    }

    const body: Record<string, unknown> = {
      ...input.payoutDetails,
      split_value: splitValue,
    };

    const response = await this.request('/subaccounts', 'POST', body);
    const data = isRecord(response.data) ? response.data : undefined;
    const subaccountId = data?.subaccount_id;
    if (
      response.status !== 'success' ||
      typeof subaccountId !== 'string' ||
      !subaccountId
    ) {
      throw new FlutterwaveApiError(
        `Flutterwave did not return a subaccount_id for organization "${input.organizationId}"`,
        undefined,
        response,
      );
    }

    return { destinationRef: subaccountId };
  }

  /**
   * Cheapest real authenticated call that fails immediately with bad credentials: Flutterwave's
   * Get All Wallet Balances endpoint
   * (developer.flutterwave.com/v3.0.0/reference/get-all-wallet-balances.md, fetched 2026-08-26):
   * `GET https://api.flutterwave.com/v3/balances`. Chosen over the per-currency balance endpoint
   * (`/v3/balances/{currency}`) specifically because it takes no parameter that could itself be
   * wrong (a currency the merchant's account doesn't hold would 400 even with valid credentials,
   * which would make "Test connection" report a false negative) — this is a pure
   * auth-and-nothing-else check, exactly what "Test connection" needs.
   */
  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    try {
      const response = await this.request('/balances', 'GET');
      if (response.status === 'success') {
        return { ok: true };
      }
      return {
        ok: false,
        message: response.message ?? 'Flutterwave rejected the request',
      };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : 'Unknown Flutterwave error',
      };
    }
  }

  private mapTransactionStatus(flutterwaveStatus: string): PaymentStatus {
    switch (flutterwaveStatus) {
      case 'successful':
        return 'completed';
      case 'failed':
        return 'failed';
      case 'pending':
        return 'pending';
      default:
        throw new FlutterwaveApiError(
          `Unrecognized Flutterwave transaction status "${flutterwaveStatus}"`,
        );
    }
  }

  private toPaymentResult(
    providerReference: string,
    response: FlutterwaveEnvelope,
  ): PaymentProviderResult {
    const data = isRecord(response.data) ? response.data : undefined;
    const status = data?.status;
    if (response.status !== 'success' || typeof status !== 'string') {
      throw new FlutterwaveApiError(
        `Flutterwave verify response for reference "${providerReference}" is missing a transaction status`,
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
   * Plain global `fetch()`, no HTTP client library — matching `ResendEmailProvider`'s exact
   * convention for calling a real third-party REST API from this codebase. `safe-fetch.ts`'s SSRF
   * guard (assertSafeWebhookUrl/safeFetch) is deliberately NOT used here: that guard exists for
   * URLs a tenant configured themselves (arbitrary webhook targets), whereas every URL this
   * method builds is a path appended to the hardcoded, first-party `FLUTTERWAVE_API_BASE_URL`
   * constant above — there is no attacker-controlled host to defend against here the way there is
   * for a user-supplied webhook URL.
   *
   * Centralizes every failure mode a Flutterwave call can hit: a network error/timeout, a
   * non-JSON body, a non-2xx status, or a JSON body missing the `status` field every Flutterwave
   * v3 response documents — each surfaces as a `FlutterwaveApiError`, never a silent
   * misclassification.
   */
  private async request(
    path: string,
    method: 'GET' | 'POST',
    body?: Record<string, unknown>,
  ): Promise<FlutterwaveEnvelope> {
    let response: Response;
    try {
      response = await fetch(`${FLUTTERWAVE_API_BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(FLUTTERWAVE_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown network error';
      this.logger.error(`Flutterwave request to ${path} failed: ${message}`);
      // No HTTP response was ever received — Flutterwave may have genuinely processed this
      // request despite the timeout/network failure on our end. `ambiguous: true` (the 4th
      // constructor arg) is what distinguishes this from every other FlutterwaveApiError below,
      // which all represent a definite response Flutterwave actually sent.
      throw new FlutterwaveApiError(
        `Network error calling Flutterwave (${path}): ${message}`,
        undefined,
        undefined,
        true,
      );
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new FlutterwaveApiError(
        `Flutterwave returned a non-JSON response (HTTP ${response.status}) for ${path}`,
        response.status,
      );
    }

    if (!isRecord(parsed) || typeof parsed.status !== 'string') {
      throw new FlutterwaveApiError(
        `Flutterwave returned an unexpected response shape for ${path}`,
        response.status,
        parsed,
      );
    }

    if (!response.ok) {
      const message =
        typeof parsed.message === 'string'
          ? parsed.message
          : `Flutterwave responded with status ${response.status}`;
      throw new FlutterwaveApiError(message, response.status, parsed);
    }

    return {
      status: parsed.status,
      message: typeof parsed.message === 'string' ? parsed.message : undefined,
      data: parsed.data,
    };
  }
}
