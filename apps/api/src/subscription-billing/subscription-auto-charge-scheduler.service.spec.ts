import type { ConfigService } from '@nestjs/config';
import { UnprocessableEntityException } from '@nestjs/common';
import { Types } from 'mongoose';
import { SubscriptionAutoChargeSchedulerService } from './subscription-auto-charge-scheduler.service';
import type { SubscriptionInvoicesRepository } from '../subscriptions/subscription-invoices.repository';
import type { PaymentMandatesRepository } from '../subscriptions/payment-mandates.repository';
import type { PaymentProviderResolverService } from '../finance/payments/providers/payment-provider-resolver.service';
import type { SubscriptionBillingService } from './subscription-billing.service';
import type { SubscriptionInvoiceDocument } from '../subscriptions/schemas/subscription-invoice.schema';

const upsertJobSchedulerMock = jest.fn();
const workerCtorMock = jest.fn();

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    upsertJobScheduler: upsertJobSchedulerMock,
    close: jest.fn(),
    on: jest.fn(),
    waitUntilReady: jest.fn().mockResolvedValue(undefined),
  })),
  Worker: jest.fn().mockImplementation((name: string, processor: unknown) => {
    workerCtorMock(name, processor);
    return {
      on: jest.fn(),
      close: jest.fn(),
      waitUntilReady: jest.fn().mockResolvedValue(undefined),
    };
  }),
}));

jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({ disconnect: jest.fn() })),
);

const ORG_ID = new Types.ObjectId();
const INVOICE_ID = new Types.ObjectId();

/** An ambiguous provider failure: duck-typed `ambiguous: true`, per the interface's marker. */
class AmbiguousError extends Error {
  readonly ambiguous = true as const;
}

function openInvoice(): SubscriptionInvoiceDocument {
  return {
    _id: INVOICE_ID,
    id: INVOICE_ID.toString(),
    organizationId: ORG_ID,
    number: 'ABO-0001',
    status: 'open',
    amount: 2900,
    currency: 'EUR',
  } as unknown as SubscriptionInvoiceDocument;
}

async function buildHarness(
  options: {
    invoices?: SubscriptionInvoiceDocument[];
    mandate?: unknown;
    chargeStatus?: string;
    chargeThrows?: Error;
    noChargeRecurring?: boolean;
    resolveThrows?: boolean;
  } = {},
) {
  const configService = {
    getOrThrow: jest.fn().mockReturnValue('redis://localhost:6380'),
    get: jest
      .fn()
      .mockImplementation((key: string) =>
        key === 'NODE_ENV' ? 'production' : undefined,
      ),
  } as unknown as ConfigService;

  const chargeRecurring = options.chargeThrows
    ? jest.fn().mockRejectedValue(options.chargeThrows)
    : jest.fn().mockResolvedValue({
        providerReference: 'korva_auto_ABO-0001',
        status: options.chargeStatus ?? 'completed',
      });

  const provider: Record<string, unknown> = { name: 'paystack' };
  if (!options.noChargeRecurring) provider.chargeRecurring = chargeRecurring;

  const resolve = options.resolveThrows
    ? jest.fn().mockRejectedValue(
        new UnprocessableEntityException({
          code: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
        }),
      )
    : jest.fn().mockResolvedValue(provider);

  const invoicesRepository = {
    findOpen: jest.fn().mockResolvedValue(options.invoices ?? [openInvoice()]),
  };
  const mandatesRepository = {
    findActiveDecrypted: jest.fn().mockResolvedValue(
      options.mandate === undefined
        ? {
            id: 'mandate-1',
            provider: 'paystack',
            reference: 'AUTH_abc123',
            payerEmail: 'owner@korva.test',
          }
        : options.mandate,
    ),
    markUsed: jest.fn().mockResolvedValue(undefined),
    revoke: jest.fn().mockResolvedValue(undefined),
  };
  const billingService = {
    settleAsPaid: jest.fn().mockResolvedValue(true),
    tryAutoPayFromWallet: jest.fn().mockResolvedValue(false),
  };

  const service = new SubscriptionAutoChargeSchedulerService(
    configService,
    invoicesRepository as unknown as SubscriptionInvoicesRepository,
    mandatesRepository as unknown as PaymentMandatesRepository,
    { resolve } as unknown as PaymentProviderResolverService,
    billingService as unknown as SubscriptionBillingService,
  );
  await service.onModuleInit();
  const calls = workerCtorMock.mock.calls as unknown[][];
  const processor = calls[0]?.[1] as () => Promise<void>;
  return {
    runSweep: processor,
    chargeRecurring,
    mandatesRepository,
    billingService,
    resolve,
  };
}

describe('SubscriptionAutoChargeSchedulerService', () => {
  beforeEach(() => {
    upsertJobSchedulerMock.mockReset().mockResolvedValue(undefined);
    workerCtorMock.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('charges an open invoice against the stored mandate and settles it', async () => {
    const h = await buildHarness();

    await h.runSweep();

    const calls = h.chargeRecurring.mock.calls as unknown[][];
    const input = calls[0]?.[0] as {
      mandateReference: string;
      amount: number;
      currency: string;
      reference: string;
      customerEmail: string;
    };
    expect(input.mandateReference).toBe('AUTH_abc123');
    expect(input.amount).toBe(2900);
    // Derived from the invoice number, so a retry of the same invoice reuses it and a
    // deduplicating provider cannot create a second charge.
    expect(input.reference).toBe('korva_auto_ABO-0001');
    // Must be the mandate's own email, not an arbitrary current user's.
    expect(input.customerEmail).toBe('owner@korva.test');
    expect(h.billingService.settleAsPaid).toHaveBeenCalledTimes(1);
    expect(h.mandatesRepository.markUsed).toHaveBeenCalledWith('mandate-1');
  });

  it('revokes the mandate on a provider-confirmed decline and leaves the invoice payable', async () => {
    const h = await buildHarness({ chargeStatus: 'failed' });

    await h.runSweep();

    expect(h.mandatesRepository.revoke).toHaveBeenCalledTimes(1);
    // The invoice is NOT settled: it stays open with the payment link it already carries.
    expect(h.billingService.settleAsPaid).not.toHaveBeenCalled();
  });

  it('leaves everything untouched on an ambiguous provider failure — never a double charge', async () => {
    const h = await buildHarness({
      chargeThrows: new AmbiguousError('timeout'),
    });

    await expect(h.runSweep()).resolves.toBeUndefined();

    // The charge may have succeeded. Marking it paid would risk locking out a paying customer;
    // revoking the mandate would retry a charge that may already exist.
    expect(h.billingService.settleAsPaid).not.toHaveBeenCalled();
    expect(h.mandatesRepository.revoke).not.toHaveBeenCalled();
    expect(h.mandatesRepository.markUsed).not.toHaveBeenCalled();
  });

  it('skips an organization with no stored mandate', async () => {
    const h = await buildHarness({ mandate: null });

    await h.runSweep();

    expect(h.chargeRecurring).not.toHaveBeenCalled();
    expect(h.billingService.settleAsPaid).not.toHaveBeenCalled();
  });

  it('skips a provider that cannot charge unattended, rather than failing', async () => {
    const h = await buildHarness({ noChargeRecurring: true });

    await expect(h.runSweep()).resolves.toBeUndefined();

    expect(h.billingService.settleAsPaid).not.toHaveBeenCalled();
    expect(h.mandatesRepository.revoke).not.toHaveBeenCalled();
  });

  it('skips quietly when no subscription-billing provider is configured at all', async () => {
    const h = await buildHarness({ resolveThrows: true });

    await expect(h.runSweep()).resolves.toBeUndefined();

    expect(h.billingService.settleAsPaid).not.toHaveBeenCalled();
  });

  it('one invoice failing does not abort the rest of the sweep', async () => {
    const h = await buildHarness({
      invoices: [openInvoice(), openInvoice()],
    });
    h.chargeRecurring
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({
        providerReference: 'korva_auto_ABO-0001',
        status: 'completed',
      });

    await h.runSweep();

    expect(h.chargeRecurring).toHaveBeenCalledTimes(2);
    expect(h.billingService.settleAsPaid).toHaveBeenCalledTimes(1);
  });
});
