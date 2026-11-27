import type { SubscriptionsService } from './subscriptions.service';
import type { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { SubscriptionPeriodSchedulerService } from './subscription-period-scheduler.service';
import type { SubscriptionsRepository } from './subscriptions.repository';
import type { SubscriptionInvoicesRepository } from './subscription-invoices.repository';
import type { PlansRepository } from './plans.repository';
import type { CountersService } from '../core/counters/counters.service';
import type { AuditService } from '../audit/audit.service';
import type { SubscriptionDocument } from './schemas/subscription.schema';

const upsertJobSchedulerMock = jest.fn();
const workerCtorMock = jest.fn();

// Same bullmq/ioredis stubbing as reconciliation-scheduler.service.spec.ts. The one addition:
// `Worker` records its processor argument, which is how each test below drives one real sweep
// (the service passes `async () => this.runSweep()` as that argument) without reaching into a
// private method.
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

/** `jest.Mock.mock.calls` is `any[][]`; this narrows one argument of the first call exactly once
 *  so no call site has to do an unsafe member access. */
function firstCallArg<T>(mock: jest.Mock, index = 0): T {
  const calls = mock.mock.calls as unknown[][];
  const call = calls[0];
  if (!call)
    throw new Error('expected the mock to have been called at least once');
  return call[index] as T;
}

/** Every `metadata` object AuditService.record was called with, typed — asserting on these
 *  directly avoids nested `expect.objectContaining`, whose return type is `any`. */
function auditReasons(mock: jest.Mock): Record<string, unknown>[] {
  const calls = mock.mock.calls as unknown[][];
  return calls.map((call) => {
    const entry = call[0] as { metadata?: Record<string, unknown> };
    return entry.metadata ?? {};
  });
}

const ORG_ID = new Types.ObjectId();
const SUB_ID = new Types.ObjectId();
const PLAN_ID = new Types.ObjectId();

/** A renewal candidate: 'active', not canceling, period already ended. */
function candidate(
  overrides: Partial<{
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: Date;
    prorationAmount: number | null;
    prorationCurrency: string | null;
  }> = {},
): SubscriptionDocument {
  return {
    _id: SUB_ID,
    id: SUB_ID.toString(),
    organizationId: ORG_ID,
    planId: PLAN_ID,
    status: 'active',
    cancelAtPeriodEnd: overrides.cancelAtPeriodEnd ?? false,
    currentPeriodStart: new Date('2026-01-01T00:00:00.000Z'),
    currentPeriodEnd:
      overrides.currentPeriodEnd ?? new Date('2026-02-01T00:00:00.000Z'),
    prorationAmount: overrides.prorationAmount ?? null,
    prorationCurrency: overrides.prorationCurrency ?? null,
  } as unknown as SubscriptionDocument;
}

interface Harness {
  runSweep: () => Promise<void>;
  subscriptions: {
    findRenewalCandidates: jest.Mock;
    renewIfEligible: jest.Mock;
    cancelIfEligible: jest.Mock;
    markPastDueIfEligible: jest.Mock;
    clearAppliedProration: jest.Mock;
  };
  invoices: {
    issueForPeriod: jest.Mock;
    findLatestForSubscription: jest.Mock;
  };
  plans: { findById: jest.Mock };
  audit: { record: jest.Mock };
}

async function buildHarness(
  options: {
    plan?: {
      priceAmount: number;
      priceCurrency: string;
      interval?: string;
    } | null;
    latestInvoice?: unknown;
    candidates?: SubscriptionDocument[];
    issueResult?: unknown;
    graceDays?: string;
  } = {},
): Promise<Harness> {
  const configService = {
    getOrThrow: jest.fn().mockReturnValue('redis://localhost:6380'),
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'NODE_ENV') return 'production';
      if (key === 'SUBSCRIPTION_INVOICE_GRACE_DAYS') return options.graceDays;
      return undefined;
    }),
  } as unknown as ConfigService;

  const subscriptions = {
    findRenewalCandidates: jest
      .fn()
      .mockResolvedValue(options.candidates ?? [candidate()]),
    renewIfEligible: jest.fn().mockResolvedValue({ id: SUB_ID.toString() }),
    cancelIfEligible: jest.fn().mockResolvedValue({ id: SUB_ID.toString() }),
    markPastDueIfEligible: jest
      .fn()
      .mockResolvedValue({ id: SUB_ID.toString() }),
    clearAppliedProration: jest
      .fn()
      .mockResolvedValue({ id: SUB_ID.toString() }),
  };

  const invoices = {
    issueForPeriod: jest
      .fn()
      .mockResolvedValue(
        options.issueResult === undefined
          ? { number: 'ABO-0001', amount: 2900, currency: 'EUR' }
          : options.issueResult,
      ),
    findLatestForSubscription: jest
      .fn()
      .mockResolvedValue(options.latestInvoice ?? null),
  };

  const plans = {
    findById: jest
      .fn()
      .mockResolvedValue(
        options.plan === undefined
          ? { priceAmount: 0, priceCurrency: 'EUR' }
          : options.plan,
      ),
  };

  const audit = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new SubscriptionPeriodSchedulerService(
    configService,
    subscriptions as unknown as SubscriptionsRepository,
    invoices as unknown as SubscriptionInvoicesRepository,
    plans as unknown as PlansRepository,
    {
      nextFormatted: jest.fn().mockResolvedValue('ABO-0001'),
    } as unknown as CountersService,
    audit as unknown as AuditService,
    {
      settleExpiredTrials: jest.fn().mockResolvedValue(0),
    } as unknown as SubscriptionsService,
  );

  await service.onModuleInit();
  const processor = firstCallArg<() => Promise<void>>(workerCtorMock, 1);
  return { runSweep: processor, subscriptions, invoices, plans, audit };
}

describe('SubscriptionPeriodSchedulerService — renewal billing', () => {
  beforeEach(() => {
    upsertJobSchedulerMock.mockReset().mockResolvedValue(undefined);
    workerCtorMock.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('a free plan renews without issuing any invoice — unchanged pre-billing behavior', async () => {
    const h = await buildHarness({
      plan: { priceAmount: 0, priceCurrency: 'EUR' },
    });

    await h.runSweep();

    expect(h.subscriptions.renewIfEligible).toHaveBeenCalledTimes(1);
    expect(h.invoices.issueForPeriod).not.toHaveBeenCalled();
    // A free plan has nothing to be unpaid, so it is never even looked up.
    expect(h.invoices.findLatestForSubscription).not.toHaveBeenCalled();
    expect(h.subscriptions.markPastDueIfEligible).not.toHaveBeenCalled();
  });

  it('a paid plan with no prior invoice issues one for the upcoming period, then renews', async () => {
    const h = await buildHarness({
      plan: { priceAmount: 2900, priceCurrency: 'EUR' },
    });

    await h.runSweep();

    expect(h.invoices.issueForPeriod).toHaveBeenCalledTimes(1);
    const issued = firstCallArg<{
      amount: number;
      currency: string;
      number: string;
      periodStart: Date;
      periodEnd: Date;
      dueAt: Date;
      issuedAt: Date;
    }>(h.invoices.issueForPeriod);
    expect(issued.amount).toBe(2900);
    expect(issued.currency).toBe('EUR');
    expect(issued.number).toBe('ABO-0001');
    // The invoice covers the period the renewal is about to grant: it starts where the old one
    // ended and runs one month, never "now"-anchored.
    expect(issued.periodStart.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(issued.periodEnd.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    // Default grace window: 7 days after issuance.
    expect(issued.dueAt.getTime() - issued.issuedAt.getTime()).toBe(
      7 * 24 * 3600 * 1000,
    );
    expect(h.subscriptions.renewIfEligible).toHaveBeenCalledTimes(1);
    expect(h.subscriptions.markPastDueIfEligible).not.toHaveBeenCalled();
  });

  it.each([
    ['half_year', '2026-08-01T00:00:00.000Z'],
    ['year', '2027-02-01T00:00:00.000Z'],
  ])(
    'a %s plan is invoiced and renewed for its own length, not one month',
    async (interval, expectedEnd) => {
      const h = await buildHarness({
        plan: { priceAmount: 99000, priceCurrency: 'XOF', interval },
      });

      await h.runSweep();

      const issued = firstCallArg<{ periodStart: Date; periodEnd: Date }>(
        h.invoices.issueForPeriod,
      );
      expect(issued.periodStart.toISOString()).toBe('2026-02-01T00:00:00.000Z');
      expect(issued.periodEnd.toISOString()).toBe(expectedEnd);
      // The subscription's own period moves by the same length as the invoice it was billed.
      const renewArgs = h.subscriptions.renewIfEligible.mock.calls[0] as [
        string,
        string,
        Date,
        Date,
      ];
      expect(renewArgs[3].toISOString()).toBe(expectedEnd);
    },
  );

  it('SUBSCRIPTION_INVOICE_GRACE_DAYS overrides the default grace window', async () => {
    const h = await buildHarness({
      plan: { priceAmount: 2900, priceCurrency: 'EUR' },
      graceDays: '3',
    });

    await h.runSweep();

    const issued = firstCallArg<{ dueAt: Date; issuedAt: Date }>(
      h.invoices.issueForPeriod,
    );
    expect(issued.dueAt.getTime() - issued.issuedAt.getTime()).toBe(
      3 * 24 * 3600 * 1000,
    );
  });

  it("an unpaid prior invoice past its grace window moves the subscription to 'past_due' and grants no new period", async () => {
    const h = await buildHarness({
      plan: { priceAmount: 2900, priceCurrency: 'EUR' },
      latestInvoice: {
        status: 'open',
        number: 'ABO-0001',
        dueAt: new Date(Date.now() - 60_000),
      },
    });

    await h.runSweep();

    expect(h.subscriptions.markPastDueIfEligible).toHaveBeenCalledTimes(1);
    // The two things that must NOT happen: another period, and another invoice on top of the
    // one already unpaid.
    expect(h.subscriptions.renewIfEligible).not.toHaveBeenCalled();
    expect(h.invoices.issueForPeriod).not.toHaveBeenCalled();
    expect(auditReasons(h.audit.record)).toContainEqual(
      expect.objectContaining({
        status: 'past_due',
        reason: 'subscription_invoice_unpaid',
        unpaidInvoiceNumber: 'ABO-0001',
      }),
    );
  });

  it('an unpaid prior invoice still inside its grace window renews normally', async () => {
    const h = await buildHarness({
      plan: { priceAmount: 2900, priceCurrency: 'EUR' },
      latestInvoice: {
        status: 'open',
        number: 'ABO-0001',
        dueAt: new Date(Date.now() + 60_000),
      },
    });

    await h.runSweep();

    expect(h.subscriptions.markPastDueIfEligible).not.toHaveBeenCalled();
    expect(h.invoices.issueForPeriod).toHaveBeenCalledTimes(1);
    expect(h.subscriptions.renewIfEligible).toHaveBeenCalledTimes(1);
  });

  it('a paid prior invoice renews normally even long after its due date', async () => {
    const h = await buildHarness({
      plan: { priceAmount: 2900, priceCurrency: 'EUR' },
      latestInvoice: {
        status: 'paid',
        number: 'ABO-0001',
        dueAt: new Date(Date.now() - 90 * 24 * 3600 * 1000),
      },
    });

    await h.runSweep();

    expect(h.subscriptions.markPastDueIfEligible).not.toHaveBeenCalled();
    expect(h.subscriptions.renewIfEligible).toHaveBeenCalledTimes(1);
  });

  it('a period whose invoice was already issued (retried sweep) still renews, and is not double-billed', async () => {
    const h = await buildHarness({
      plan: { priceAmount: 2900, priceCurrency: 'EUR' },
      issueResult: null, // unique (subscriptionId, periodStart) index rejected the second insert
    });

    await h.runSweep();

    expect(h.subscriptions.renewIfEligible).toHaveBeenCalledTimes(1);
    // No "invoice issued" audit entry for an issuance that did not actually happen.
    expect(auditReasons(h.audit.record).map((m) => m.reason)).not.toContain(
      'subscription_invoice_issued',
    );
  });

  it('a subscription whose plan no longer exists is never renewed and never silently granted a free period', async () => {
    const h = await buildHarness({ plan: null });

    // The sweep swallows per-candidate failures by design, so this must not reject.
    await expect(h.runSweep()).resolves.toBeUndefined();

    expect(h.subscriptions.renewIfEligible).not.toHaveBeenCalled();
    expect(h.invoices.issueForPeriod).not.toHaveBeenCalled();
    expect(h.subscriptions.markPastDueIfEligible).not.toHaveBeenCalled();
  });

  it('one candidate failing does not abort the rest of the sweep', async () => {
    const other = candidate();
    const h = await buildHarness({
      plan: { priceAmount: 0, priceCurrency: 'EUR' },
      candidates: [candidate(), other],
    });
    h.subscriptions.renewIfEligible
      .mockRejectedValueOnce(new Error('transient mongo error'))
      .mockResolvedValueOnce({ id: SUB_ID.toString() });

    await h.runSweep();

    expect(h.subscriptions.renewIfEligible).toHaveBeenCalledTimes(2);
  });

  describe('mid-period proration folded into the next invoice', () => {
    it('adds a positive proration to the period price, then clears it so it bills once', async () => {
      const h = await buildHarness({
        plan: { priceAmount: 2900, priceCurrency: 'EUR' },
        candidates: [
          candidate({ prorationAmount: 1500, prorationCurrency: 'EUR' }),
        ],
      });

      await h.runSweep();

      expect(
        firstCallArg<{ amount: number }>(h.invoices.issueForPeriod).amount,
      ).toBe(4400);
      // Cleared only once the invoice exists, and guarded on the exact amount applied.
      expect(h.subscriptions.clearAppliedProration).toHaveBeenCalledWith(
        ORG_ID.toString(),
        SUB_ID.toString(),
        1500,
      );
    });

    it('subtracts a credit from the period price', async () => {
      const h = await buildHarness({
        plan: { priceAmount: 2900, priceCurrency: 'EUR' },
        candidates: [
          candidate({ prorationAmount: -900, prorationCurrency: 'EUR' }),
        ],
      });

      await h.runSweep();

      expect(
        firstCallArg<{ amount: number }>(h.invoices.issueForPeriod).amount,
      ).toBe(2000);
    });

    it('never issues a negative or zero invoice: a credit beyond the price issues nothing and still renews', async () => {
      const h = await buildHarness({
        plan: { priceAmount: 2900, priceCurrency: 'EUR' },
        candidates: [
          candidate({ prorationAmount: -5000, prorationCurrency: 'EUR' }),
        ],
      });

      await h.runSweep();

      // A zero-amount invoice would hand the tenant a checkout link for nothing.
      expect(h.invoices.issueForPeriod).not.toHaveBeenCalled();
      expect(h.subscriptions.renewIfEligible).toHaveBeenCalledTimes(1);
      expect(h.subscriptions.clearAppliedProration).toHaveBeenCalledTimes(1);
      // The discarded part of the credit is surfaced rather than silently swallowed.
      expect(auditReasons(h.audit.record)).toContainEqual(
        expect.objectContaining({
          reason: 'subscription_period_fully_covered_by_credit',
          unappliedCredit: 2100,
        }),
      );
    });

    it('ignores — and deliberately does not clear — a proration stored in another currency', async () => {
      const h = await buildHarness({
        plan: { priceAmount: 2900, priceCurrency: 'EUR' },
        candidates: [
          candidate({ prorationAmount: 1500, prorationCurrency: 'MAD' }),
        ],
      });

      await h.runSweep();

      // Mixing currencies in one amount is never acceptable; the invoice bills the plan alone.
      expect(
        firstCallArg<{ amount: number }>(h.invoices.issueForPeriod).amount,
      ).toBe(2900);
      // Left in place so it stays visible for a human instead of being discarded unbilled.
      expect(h.subscriptions.clearAppliedProration).not.toHaveBeenCalled();
    });

    it('leaves a stored proration untouched when the subscription goes past_due instead', async () => {
      const h = await buildHarness({
        plan: { priceAmount: 2900, priceCurrency: 'EUR' },
        candidates: [
          candidate({ prorationAmount: 1500, prorationCurrency: 'EUR' }),
        ],
        latestInvoice: {
          status: 'open',
          number: 'ABO-0001',
          dueAt: new Date(Date.now() - 60_000),
        },
      });

      await h.runSweep();

      // Still owed: nothing was billed, so nothing may be consumed.
      expect(h.subscriptions.clearAppliedProration).not.toHaveBeenCalled();
    });
  });

  it('a cancel-at-period-end subscription is canceled and never invoiced', async () => {
    const h = await buildHarness({
      plan: { priceAmount: 2900, priceCurrency: 'EUR' },
      candidates: [candidate({ cancelAtPeriodEnd: true })],
    });

    await h.runSweep();

    expect(h.subscriptions.cancelIfEligible).toHaveBeenCalledTimes(1);
    expect(h.invoices.issueForPeriod).not.toHaveBeenCalled();
    expect(h.subscriptions.renewIfEligible).not.toHaveBeenCalled();
  });
});
