import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { SubscriptionBillingService } from './subscription-billing.service';
import type { SubscriptionInvoicesRepository } from '../subscriptions/subscription-invoices.repository';
import type { SubscriptionsRepository } from '../subscriptions/subscriptions.repository';
import type { PaymentMandatesRepository } from '../subscriptions/payment-mandates.repository';
import type { PaymentProviderResolverService } from '../finance/payments/providers/payment-provider-resolver.service';
import type { AuditService } from '../audit/audit.service';
import type { WalletService } from '../finance/wallet/wallet.service';
import type { SubscriptionInvoiceDocument } from '../subscriptions/schemas/subscription-invoice.schema';

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
  mandates: { capture: jest.Mock };
  provider: {
    name: string;
    createPayment: jest.Mock;
    verifyPayment: jest.Mock;
  };
  resolve: jest.Mock;
  audit: { record: jest.Mock };
  wallet: {
    debitForSubscription: jest.Mock;
    refundSubscriptionDebit: jest.Mock;
    refundSubscriptionPaidTwice: jest.Mock;
    subscriptionAutopayEnabled: jest.Mock;
  };
}

function buildHarness(
  options: {
    invoice?: Record<string, unknown> | null;
    createPaymentResult?: unknown;
    providerStatus?: string;
    mandateReference?: string;
    reactivated?: unknown;
    resolveError?: Error;
    captureThrows?: boolean;
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
    verifyPayment: jest.fn().mockResolvedValue({
      providerReference: 'korva_ABO-0001_abc',
      status: options.providerStatus ?? 'completed',
      ...(options.mandateReference
        ? { mandateReference: options.mandateReference }
        : {}),
    }),
  };
  const resolve = options.resolveError
    ? jest.fn().mockRejectedValue(options.resolveError)
    : jest.fn().mockResolvedValue(provider);
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const mandates = {
    capture: options.captureThrows
      ? jest.fn().mockRejectedValue(new Error('encryption key rotated'))
      : jest.fn().mockResolvedValue(undefined),
  };

  const wallet = {
    debitForSubscription: jest.fn().mockResolvedValue('entry-1'),
    refundSubscriptionDebit: jest.fn().mockResolvedValue(undefined),
    refundSubscriptionPaidTwice: jest.fn().mockResolvedValue(true),
    subscriptionAutopayEnabled: jest.fn().mockResolvedValue(true),
  };
  const service = new SubscriptionBillingService(
    invoices as unknown as SubscriptionInvoicesRepository,
    subscriptions as unknown as SubscriptionsRepository,
    mandates as unknown as PaymentMandatesRepository,
    { resolve } as unknown as PaymentProviderResolverService,
    {
      get: jest.fn().mockReturnValue('https://app.korva.test'),
    } as unknown as ConfigService,
    audit as unknown as AuditService,
    wallet as unknown as WalletService,
  );
  return {
    service,
    invoices,
    subscriptions,
    mandates,
    provider,
    resolve,
    audit,
    wallet,
  };
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

  it('captures a reusable authorization when the provider returns one', async () => {
    const h = buildHarness({
      invoice: openInvoice({
        providerReference: 'korva_ABO-0001_abc',
        payerEmail: 'owner@korva.test',
      }),
      providerStatus: 'completed',
      mandateReference: 'AUTH_abc123',
    });

    await h.service.verifyPayment(ORG, INVOICE_ID);

    expect(h.mandates.capture).toHaveBeenCalledWith({
      organizationId: ORG,
      provider: 'paystack',
      reference: 'AUTH_abc123',
      // Must be the email the checkout was opened under: both providers reject a recurring
      // charge whose email differs from the authorization's.
      payerEmail: 'owner@korva.test',
    });
  });

  it('captures nothing when the provider returns no reusable authorization', async () => {
    const h = buildHarness({
      invoice: openInvoice({ providerReference: 'korva_ABO-0001_abc' }),
      providerStatus: 'completed',
    });

    await h.service.verifyPayment(ORG, INVOICE_ID);

    expect(h.mandates.capture).not.toHaveBeenCalled();
  });

  it('still reports the payment as paid when storing the mandate fails', async () => {
    const h = buildHarness({
      invoice: openInvoice({ providerReference: 'korva_ABO-0001_abc' }),
      providerStatus: 'completed',
      mandateReference: 'AUTH_abc123',
      captureThrows: true,
    });

    // A failure to store an optimization must never turn a real payment into an error.
    const result = await h.service.verifyPayment(ORG, INVOICE_ID);

    expect(result.status).toBe('paid');
    expect(h.invoices.markPaidIfOpen).toHaveBeenCalledTimes(1);
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

describe('SubscriptionBillingService — paying from the Solde KORVA', () => {
  it('takes the amount off the balance and settles the invoice', async () => {
    const h = buildHarness();
    await expect(h.service.payFromWallet(ORG, INVOICE_ID)).resolves.toEqual({
      invoiceNumber: 'ABO-0001',
      status: 'paid',
    });
    expect(h.wallet.debitForSubscription).toHaveBeenCalledWith(ORG, {
      id: INVOICE_ID,
      number: 'ABO-0001',
      amount: 2900,
      currency: 'EUR',
    });
    expect(h.invoices.markPaidIfOpen).toHaveBeenCalledWith(ORG, INVOICE_ID);
    expect(h.wallet.refundSubscriptionDebit).not.toHaveBeenCalled();
  });

  it('gives the amount back when the invoice got paid in the meantime', async () => {
    const h = buildHarness();
    h.invoices.markPaidIfOpen.mockResolvedValue(null);
    await expect(
      h.service.payFromWallet(ORG, INVOICE_ID),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(h.wallet.refundSubscriptionDebit).toHaveBeenCalledWith(
      ORG,
      'entry-1',
    );
  });

  it('settles from a checkout GeniusPay already completed, without touching the balance', async () => {
    const h = buildHarness({
      invoice: openInvoice({ providerReference: 'MTX-1' }),
    });
    await expect(
      h.service.payFromWallet(ORG, INVOICE_ID),
    ).resolves.toMatchObject({ status: 'paid' });
    expect(h.wallet.debitForSubscription).not.toHaveBeenCalled();
  });

  it('gives the balance back when an invoice paid from it is also paid by its old link', async () => {
    const h = buildHarness({
      invoice: openInvoice({ status: 'paid', providerReference: 'MTX-1' }),
    });
    await expect(h.service.verifyPayment(ORG, INVOICE_ID)).resolves.toEqual({
      invoiceNumber: 'ABO-0001',
      status: 'paid',
    });
    expect(h.wallet.refundSubscriptionPaidTwice).toHaveBeenCalledWith(
      ORG,
      INVOICE_ID,
    );
  });

  it('auto-pays only when switched on, and leaves a too-low balance to the usual means', async () => {
    const h = buildHarness();
    const invoice = {
      ...openInvoice(),
      organizationId: ORG,
    } as unknown as SubscriptionInvoiceDocument;
    h.wallet.subscriptionAutopayEnabled.mockResolvedValueOnce(false);
    await expect(h.service.tryAutoPayFromWallet(invoice)).resolves.toBe(false);
    expect(h.wallet.debitForSubscription).not.toHaveBeenCalled();

    h.wallet.debitForSubscription.mockRejectedValueOnce(
      new UnprocessableEntityException({ code: 'WALLET_INSUFFICIENT_BALANCE' }),
    );
    await expect(h.service.tryAutoPayFromWallet(invoice)).resolves.toBe(false);
    await expect(h.service.tryAutoPayFromWallet(invoice)).resolves.toBe(true);
  });
});
