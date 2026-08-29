import type { PaymentStatus } from '@korva/types';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface PaymentProviderResult {
  providerReference: string;
  status: PaymentStatus;
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
}

/**
 * Business logic must never talk to a payment gateway (Stripe, CinetPay, Paystack,
 * Flutterwave, ...) directly — only through this interface, injected via the
 * PAYMENT_PROVIDER token. Swapping providers means adding a new implementation
 * and rebinding the token, never touching QuotesService/InvoicesService/PaymentsService.
 */
export interface PaymentProvider {
  readonly name: string;
  createPayment(input: {
    amount: number;
    currency: string;
    invoiceId: string;
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
   * Lightweight authenticated call proving stored credentials actually work — used by the
   * Settings → Integrations "Test connection" action (Wave 4 Stage 2). See
   * MessagingProvider.testConnection's doc for the same contract shape and rationale.
   */
  testConnection?(): Promise<{ ok: boolean; message?: string }>;
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
