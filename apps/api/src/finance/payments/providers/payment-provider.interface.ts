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
}
