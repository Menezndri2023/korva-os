import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { SubscriptionBillingService } from './subscription-billing.service';
import type { SubscriptionInvoicesRepository } from '../subscriptions/subscription-invoices.repository';
import type { SubscriptionsRepository } from '../subscriptions/subscriptions.repository';
import type { PaymentProviderResolverService } from '../finance/payments/providers/payment-provider-resolver.service';
import type { AuditService } from '../audit/audit.service';

const ORG = 'org-1';
const INVOICE_ID = 'invoice-1';

function openInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: INVOICE_ID,
    number: 'ABO-0001',
    status: 'open',
    amount: 2900,
    currency: 'EUR',
    providerReference: null,
    checkoutUrl: null,
    ...overrides,
  };
}

interface Harness {
  service: SubscriptionBillingService;
  invoices: {
    findOwnedById: jest.Mock;
    attachCheckout: jest.Mock;
    markPaidIfOpen: jest.Mock;
  };
  subscriptions: { reactivateFromPastDue: jest.Mock };
  provider: {
    name: string;
    createPayment: jest.Mock;
    getPaymentStatus: jest.Mock;
  };
  resolve: jest.Mock;
  audit: { record: jest.Mock };
}

function buildHarness(
  options: {
    invoice?: Record<string, unknown> | null;
    createPaymentResult?: unknown;
    providerStatus?: string;
    reactivated?: unknown;
    resolveError?: Error;
  } = {},
): Harness {
  const invoices = {
    findOwnedById: jest
      .fn()
      .mockResolvedValue(
        options.invoice === undefined ? openInvoice() : options.invoice,
      ),
    attachCheckout: jest
      .fn()
      .mockImplementation(
        (
          _org: string,
          _id: string,
          providerReference: string,
          checkoutUrl: string,
        ) => Promise.resolve({ providerReference, checkoutUrl }),
      ),
    markPaidIfOpen: jest.fn().mockResolvedValue({ number: 'ABO-0001' }),
  };
  const subscriptions = {
    reactivateFromPastDue: jest
      .fn()
      .mockResolvedValue(options.reactivated ?? null),
  };
  const provider = {
    name: 'paystack',
    createPayment: jest.fn().mockResolvedValue(
      options.createPaymentResult === undefined
        ? {
            providerReference: 'korva_ABO-0001_abc',
            status: 'pending',
            checkoutUrl: 'https://checkout.paystack.com/xyz',
          }
        : options.createPaymentResult,
    ),
    getPaymentStatus: jest
      .fn()
      .mockResolvedValue(options.providerStatus ?? 'completed'),
  };
  const resolve = options.resolveError
    ? jest.fn().mockRejectedValue(options.resolveError)
    : jest.fn().mockResolvedValue(provider);
  const audit = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new SubscriptionBillingService(
    invoices as unknown as SubscriptionInvoicesRepository,
    subscriptions as unknown as SubscriptionsRepository,
    { resolve } as unknown as PaymentProviderResolverService,
    {
      get: jest.fn().mockReturnValue('https://app.korva.test'),
    } as unknown as ConfigService,
    audit as unknown as AuditService,
  );
  return { service, invoices, subscriptions, provider, resolve, audit };
}

describe('SubscriptionBillingService — createCheckout', () => {
  it('creates a hosted checkout for an open invoice and stores the provider reference', async () => {
    const h = buildHarness();

    const result = await h.service.createCheckout(
      ORG,
      INVOICE_ID,
      'owner@korva.test',
    );

    expect(h.resolve).toHaveBeenCalledWith({
      flow: 'subscription',
      organizationId: ORG,
    });
    const createPaymentCalls = h.provider.createPayment.mock
      .calls as unknown[][];
    const payment = createPaymentCalls[0]?.[0] as {
      amount: number;
      currency: string;
      invoiceId: string;
      customerEmail: string;
      redirectUrl: string;
    };
    expect(payment.amount).toBe(2900);
    expect(payment.currency).toBe('EUR');
    // The adapters only use this as a reference prefix, so the human-readable number beats the id.
    expect(payment.invoiceId).toBe('ABO-0001');
    expect(payment.customerEmail).toBe('owner@korva.test');
    expect(payment.redirectUrl).toContain('https://app.korva.test');
    expect(result.checkoutUrl).toBe('https://checkout.paystack.com/xyz');
    expect(h.invoices.attachCheckout).toHaveBeenCalledTimes(1);
  });

  it('reuses an existing checkout instead of creating a second provider transaction', async () => {
    const h = buildHarness({
      invoice: openInvoice({
        providerReference: 'korva_ABO-0001_existing',
        checkoutUrl: 'https://checkout.paystack.com/existing',
      }),
    });

    const result = await h.service.createCheckout(
      ORG,
      INVOICE_ID,
      'owner@korva.test',
    );

    expect(result.checkoutUrl).toBe('https://checkout.paystack.com/existing');
    // The whole point: no second charge path is ever opened for the same invoice.
    expect(h.provider.createPayment).not.toHaveBeenCalled();
    expect(h.resolve).not.toHaveBeenCalled();
  });

  it('refuses to create a checkout for an invoice that is already paid', async () => {
    const h = buildHarness({ invoice: openInvoice({ status: 'paid' }) });

    await expect(
      h.service.createCheckout(ORG, INVOICE_ID, 'owner@korva.test'),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(h.provider.createPayment).not.toHaveBeenCalled();
  });

  it('an invoice belonging to another tenant reads as not found', async () => {
    const h = buildHarness({ invoice: null });

    await expect(
      h.service.createCheckout(ORG, INVOICE_ID, 'owner@korva.test'),
    ).rejects.toThrow(NotFoundException);
  });

  it('fails loudly when the configured provider returns no checkout URL', async () => {
    const h = buildHarness({
      createPaymentResult: { providerReference: 'manual-1', status: 'pending' },
    });

    await expect(
      h.service.createCheckout(ORG, INVOICE_ID, 'owner@korva.test'),
    ).rejects.toThrow(UnprocessableEntityException);
    // Nothing half-written: no checkout is recorded for a provider that cannot host one.
    expect(h.invoices.attachCheckout).not.toHaveBeenCalled();
  });
});

describe('SubscriptionBillingService — verifyPayment', () => {
  it("marks the invoice paid only when the provider itself reports 'completed'", async () => {
    const h = buildHarness({
      invoice: openInvoice({ providerReference: 'korva_ABO-0001_abc' }),
      providerStatus: 'completed',
    });

    const result = await h.service.verifyPayment(ORG, INVOICE_ID);

    expect(result.status).toBe('paid');
    expect(h.invoices.markPaidIfOpen).toHaveBeenCalledTimes(1);
  });

  it('leaves the invoice open when the provider still reports it pending', async () => {
    const h = buildHarness({
      invoice: openInvoice({ providerReference: 'korva_ABO-0001_abc' }),
      providerStatus: 'pending',
    });

    const result = await h.service.verifyPayment(ORG, INVOICE_ID);

    expect(result.status).toBe('open');
    expect(h.invoices.markPaidIfOpen).not.toHaveBeenCalled();
  });

  it('paying the overdue invoice returns a past_due subscription to active', async () => {
    const h = buildHarness({
      invoice: openInvoice({ providerReference: 'korva_ABO-0001_abc' }),
      providerStatus: 'completed',
      reactivated: { id: 'sub-1' },
    });

    await h.service.verifyPayment(ORG, INVOICE_ID);

    expect(h.subscriptions.reactivateFromPastDue).toHaveBeenCalledWith(ORG);
    const reasons = (h.audit.record.mock.calls as unknown[][]).map((call) => {
      const entry = call[0] as { metadata?: { reason?: unknown } };
      return entry.metadata?.reason;
    });
    expect(reasons).toContain('subscription_invoice_paid_after_past_due');
  });

  it('a second verification of an already-paid invoice never re-stamps it', async () => {
    const h = buildHarness({ invoice: openInvoice({ status: 'paid' }) });

    const result = await h.service.verifyPayment(ORG, INVOICE_ID);

    expect(result.status).toBe('paid');
    expect(h.invoices.markPaidIfOpen).not.toHaveBeenCalled();
    expect(h.resolve).not.toHaveBeenCalled();
  });

  it('refuses to verify an invoice for which no payment was ever started', async () => {
    const h = buildHarness({
      invoice: openInvoice({ providerReference: null }),
    });

    await expect(h.service.verifyPayment(ORG, INVOICE_ID)).rejects.toThrow(
      UnprocessableEntityException,
    );
  });
});
