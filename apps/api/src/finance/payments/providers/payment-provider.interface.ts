import type { PaymentStatus } from '@korva/types';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface PaymentProviderResult {
  providerReference: string;
  status: PaymentStatus;
  /**
   * A hosted checkout URL the payer must be redirected to — set by `createPayment()` when the
   * provider's real API returns one (Flutterwave's `data.link`, Paystack's
   * `data.authorization_url`) and a `redirectUrl` was supplied in the input; absent for
   * `ManualPaymentProvider` (no real checkout exists) and for every other result type
   * (`verifyPayment`/`getPaymentStatus`/`refundPayment` never set this — there is nothing left
   * to redirect to once a payment is already resolved).
   */
  checkoutUrl?: string;
  /**
   * Stage 2.12 — a genuinely REFUND-specific provider identifier (e.g. Flutterwave's own numeric
   * refund `id`), distinct from `providerReference` (which for a refund is always the underlying
   * Payment's own merchant reference/tx_ref, never a refund-specific value — see
   * FlutterwaveProvider.refundPayment's own doc comment). Optional: only ever set by
   * `refundPayment()`, only when the provider's response actually contains it — never
   * fabricated, never required. `createPayment()`/`verifyPayment()` never set this.
   */
  providerRefundId?: string;
  /**
   * Stage 2.12 — Flutterwave's own `flw_ref`-style refund reference, if the response actually
   * contains one. Same rules as `providerRefundId`: optional, only ever set by `refundPayment()`,
   * never fabricated. Kept as a SEPARATE field from `providerRefundId` because Flutterwave's own
   * documented refund-listing schema (see FlutterwaveProvider.refundPayment's doc comment)
   * treats `id` and `flw_ref` as two distinct fields on the same refund record — collapsing them
   * into one field would destroy that distinction for no reason.
   */
  providerRefundReference?: string;
  /**
   * A REUSABLE authorization the provider issued for this payer — Paystack's
   * `data.authorization.authorization_code`, Flutterwave's saved-card `token`. Set only by
   * `verifyPayment()`, and only when the provider's own response says the authorization is
   * reusable; `createPayment()` cannot produce one, because nothing has been authorized yet at
   * that point.
   *
   * This is what makes `chargeRecurring()` possible: it is captured the first time a payer
   * completes a hosted checkout, stored encrypted (see PaymentMandate), and replayed on later
   * renewals without the payer being present. It is NOT a payment status and never implies one —
   * a failed payment can still carry an authorization, and a successful one may carry none (a
   * one-off bank transfer, a mobile-money push).
   */
  mandateReference?: string;
  /**
   * What the provider kept on this payment — GeniusPay's `fees` ("gateway + plateforme"), in
   * `providerCurrency` when that is set, else in the payment's currency. Read by the Solde KORVA
   * so a business is credited exactly what KORVA received, never an estimate. Only set by
   * `verifyPayment()`, only when the provider says it.
   */
  providerFee?: number;
  /**
   * The amount and currency the provider actually charged, when it says so. They differ from the
   * payment's own when the provider converts: GeniusPay charges a 1 EUR order as 610.70 XOF (seen
   * on a real payment, 2026-11-02) and reports its fee in XOF too.
   */
  providerAmount?: number;
  providerCurrency?: string;
}

/** A withdrawal sent to a business's mobile money account — see the Solde KORVA (finance/wallet). */
export interface PayoutRequest {
  amount: number;
  currency: string;
  /** KORVA's payout id: stable across retries, so a retry is the same payout, never a second. */
  reference: string;
  destination: { provider: string; account: string; holderName: string };
  description: string;
}

export interface PayoutResult {
  providerReference: string;
  status: 'pending' | 'completed' | 'failed';
  fee?: number;
  failureReason?: string;
}

/**
 * Business logic must never talk to a payment gateway (Stripe, CinetPay, Paystack,
 * Flutterwave, ...) directly — only through this interface, injected via the
 * PAYMENT_PROVIDER token. Swapping providers means adding a new implementation
 * and rebinding the token, never touching QuotesService/InvoicesService/PaymentsService.
 */
export interface PaymentProvider {
  /** No refund API: a refund is sent back to the customer by hand by KORVA (GeniusPay). */
  readonly refundsManually?: boolean;
  readonly name: string;
  /** ISO currencies this provider can charge; absent = no known restriction. A storefront whose
   *  currency is not listed does not offer online payment at all (PublicService), rather than
   *  sending its customers to a checkout that would refuse them. */
  readonly supportedCurrencies?: readonly string[];
  createPayment(input: {
    amount: number;
    currency: string;
    invoiceId: string;
    /**
     * Required by every real hosted-checkout adapter (Flutterwave/Paystack), unused by
     * `ManualPaymentProvider` — optional at the interface level since a caller that only ever
     * exercises the manual/staff-recorded path has no email to give. A caller that resolves a
     * real provider (see PaymentProviderResolverService) for a customer-initiated online
     * payment must supply both this and `redirectUrl`, or the concrete adapter throws.
     */
    customerEmail?: string;
    /** Where the payer's browser returns to after completing (or abandoning) a hosted checkout
     *  — see `customerEmail`'s doc comment for the same optionality rationale. */
    redirectUrl?: string;
  }): Promise<PaymentProviderResult>;
  verifyPayment(providerReference: string): Promise<PaymentProviderResult>;
  getPaymentStatus(providerReference: string): Promise<PaymentStatus>;
  /**
   * Stage 2.7A — `localReferenceForReconciliation`, when given, is a caller-chosen, non-secret
   * breadcrumb (KORVA's own local Refund id) that an adapter MAY forward to the provider as a
   * free-text comment/note field, IF the provider's real, documented API offers one on refund
   * creation — see FlutterwaveProvider's own doc comment on this exact parameter for why this
   * exists and what it does NOT (yet) enable. Optional and provider-agnostic: an adapter with no
   * such field (ManualPaymentProvider) simply never declares this parameter at all — TypeScript
   * structural typing allows an implementer to accept fewer parameters than an interface
   * declares, so this is fully backward-compatible.
   */
  refundPayment(
    providerReference: string,
    amount: number,
    localReferenceForReconciliation?: string,
  ): Promise<PaymentProviderResult>;
  /**
   * Registers a tenant's payout destination with the provider under Merchant-of-Record (see
   * docs/architecture/integrations-platform.md §4 "Split settlement") — e.g. Flutterwave's
   * Create Subaccount API. `payoutDetails` is intentionally untyped at this interface boundary
   * (provider-specific bank/mobile-money fields); returns an opaque reference this adapter's own
   * `createPayment`/settlement logic later reads back out of the tenant's IntegrationAccount
   * metadata. Optional so existing implementers (ManualPaymentProvider) keep compiling unchanged
   * — only relevant to a Merchant-of-Record adapter with real split-payment support.
   */
  createPayoutDestination?(input: {
    organizationId: string;
    payoutDetails: Record<string, string>;
  }): Promise<{ destinationRef: string }>;
  /**
   * Charges a previously captured, reusable authorization with no payer present — the
   * card-on-file path that `createPayment()` cannot provide, since every real adapter's
   * `createPayment` is a HOSTED CHECKOUT whose status stays `'pending'` until a human completes
   * a redirect.
   *
   * Optional at the interface level, and that optionality is load-bearing:
   * `ManualPaymentProvider` has no provider to call, and an adapter for a market where only
   * one-off mobile-money pushes exist may genuinely never be able to implement it. A caller MUST
   * therefore check for the method before using it and keep a working path for when it is
   * absent — see SubscriptionPeriodSchedulerService, which falls back to issuing an unpaid
   * invoice with a payment link.
   *
   * `reference` is caller-chosen and must be stable for a given charge attempt: it is the only
   * thing that lets a retry be recognized as the same attempt rather than a second charge.
   * Unlike `createPayment`, this returns a FINAL status — `'completed'` or `'failed'` — because
   * there is no redirect left to wait on. An ambiguous network failure must be thrown as an
   * error carrying `ambiguous: true` (see AmbiguousProviderErrorMarker), never collapsed into
   * `'failed'`: a caller who sees `'failed'` may legitimately charge again.
   */
  chargeRecurring?(input: {
    mandateReference: string;
    amount: number;
    currency: string;
    reference: string;
    customerEmail: string;
  }): Promise<PaymentProviderResult>;
  /**
   * Lightweight authenticated call proving stored credentials actually work — used by the
   * Settings → Integrations "Test connection" action (Wave 4 Stage 2). See
   * MessagingProvider.testConnection's doc for the same contract shape and rationale.
   */
  testConnection?(): Promise<{ ok: boolean; message?: string }>;
  /** Sends money from KORVA's provider balance to a business (GeniusPay's Payout API). */
  createPayout?(input: PayoutRequest): Promise<PayoutResult>;
  getPayout?(providerReference: string): Promise<PayoutResult>;
}

/**
 * Duck-typed marker (never a class hierarchy, so an adapter's own error class — e.g.
 * FlutterwaveApiError — never has to extend or implement anything from this provider-agnostic
 * interface file) a PaymentProvider error can carry to signal "we genuinely don't know whether
 * this request succeeded at the provider" (e.g. a network timeout / aborted request where no
 * HTTP response was ever received) — as opposed to a definite, provider-confirmed rejection
 * (a non-2xx response, a malformed body, etc., all of which mean the provider DID respond).
 *
 * Stage 2.6 — PaymentsService.create()/refund() check this before marking an idempotency claim
 * 'failed' on a provider-call exception: collapsing an ambiguous outcome into 'failed' is unsafe
 * because a caller who sees 'failed' may legitimately retry with a brand-new Idempotency-Key,
 * which — if the provider actually DID process the original request — would charge/refund the
 * customer a second time for real. Leaving the claim in its current not-yet-resolved status
 * instead lets it be found again (never silently lost), without ever inventing a new financial
 * policy: it is deliberately narrower than "auto-resolve the ambiguity" — see
 * PaymentsService.refund()'s own doc comment for the residual gap this alone does not close.
 */
export interface AmbiguousProviderErrorMarker {
  readonly ambiguous: true;
}

export function isAmbiguousProviderError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { ambiguous?: unknown }).ambiguous === true
  );
}

/**
 * Stage 2.12 — duck-typed, provider-agnostic accessor (same style/reasoning as
 * `isAmbiguousProviderError` above — never a class hierarchy, so an adapter's own error class
 * never has to extend anything from this file) for a correlation reference a provider adapter
 * MAY have already generated and sent to the provider BEFORE the network call that then failed
 * — e.g. Flutterwave's own merchant `tx_ref`, computed inside `FlutterwaveProvider.createPayment`
 * before its HTTP call, previously discarded entirely on any thrown error (see
 * FlutterwaveApiError's own doc comment on `generatedReference` for exactly when this is set).
 *
 * CRITICAL: this is PURELY a correlation identifier for a human/future process to look something
 * up by later. Its presence is NEVER evidence that the provider executed anything — an ambiguous
 * error is, by definition, an outcome KORVA cannot currently distinguish from "the provider did
 * nothing at all." PaymentsService.create() persists this (best-effort, when a claim exists)
 * purely so the reference is not permanently lost; it never changes what status the Payment ends
 * up in, and nothing reads this value back to auto-resolve anything (Stage 2.12 is
 * identifier-capture only — see that method's own doc comment).
 */
export function getAmbiguousErrorProviderReference(
  error: unknown,
): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const value = (error as { generatedReference?: unknown }).generatedReference;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
