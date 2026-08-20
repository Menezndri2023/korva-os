import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type {
  PaymentProvider,
  PaymentProviderResult,
} from './payment-provider.interface';

/**
 * Default provider for MVP: represents a payment recorded manually by staff
 * (cash, bank transfer, in-person card terminal) — no external gateway call.
 * Confirmed immediately since there is nothing to await asynchronously.
 */
@Injectable()
export class ManualPaymentProvider implements PaymentProvider {
  readonly name = 'manual';

  createPayment(): Promise<PaymentProviderResult> {
    return Promise.resolve({
      providerReference: `manual_${randomBytes(12).toString('hex')}`,
      status: 'completed',
    });
  }

  verifyPayment(providerReference: string): Promise<PaymentProviderResult> {
    return Promise.resolve({ providerReference, status: 'completed' });
  }

  getPaymentStatus(): Promise<'completed'> {
    return Promise.resolve('completed');
  }

  refundPayment(providerReference: string): Promise<PaymentProviderResult> {
    return Promise.resolve({ providerReference, status: 'refunded' });
  }
}
