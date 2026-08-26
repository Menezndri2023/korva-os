import type { PaymentStatus } from '@korva/types';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface PaymentProviderResult {
  providerReference: string;
  status: PaymentStatus;
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
  refundPayment(
    providerReference: string,
    amount: number,
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
