import { Model, Types } from 'mongoose';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import type { SubscriptionsRepository } from './subscriptions.repository';
import type { Subscription } from './schemas/subscription.schema';
import type { PlansService } from './plans.service';
import type { AuditService } from '../audit/audit.service';
import type { OrganizationDocument } from '../organizations/schemas/organization.schema';
import type { EventBusService } from '../core/events/event-bus.service';

describe('SubscriptionsService.changePlan — enabledModules synchronization', () => {
  const ORG_ID = 'org-1';
  const USER_ID = 'user-1';

  const FREE_PLAN = {
    _id: 'plan-free',
    key: 'free',
    modules: [
      'crm',
      'catalog',
      'booking',
      'commerce',
      'finance',
      'workflow',
      'communication',
      'analytics',
      'ai',
    ],
  };
  const STARTER_PLAN = {
    _id: 'plan-starter',
    key: 'starter',
    modules: [
      'crm',
      'catalog',
      'booking',
      'commerce',
      'finance',
      'communication',
      'analytics',
    ],
  };
  const PRO_PLAN = { ...FREE_PLAN, _id: 'plan-pro', key: 'pro' };

  function buildService(options: {
    plan: typeof FREE_PLAN;
    organization: { enabledModules: string[]; save: jest.Mock } | null;
  }) {
    const getByKey = jest.fn().mockResolvedValue(options.plan);
    const plansService = { getByKey } as unknown as PlansService;

    const update = jest.fn().mockResolvedValue({ id: 'sub-1' });
    // Not under test here (see the dedicated proration describe block below) — returning null
    // just means changePlan skips proration entirely, which is exactly what these
    // enabledModules-focused tests want.
    const findForOrganization = jest.fn().mockResolvedValue(null);
    const subscriptionsRepository = {
      update,
      findForOrganization,
    } as unknown as SubscriptionsRepository;

    const record = jest.fn().mockResolvedValue(undefined);
    const auditService = { record } as unknown as AuditService;

    const exec = jest.fn().mockResolvedValue(options.organization);
    // `.select()` is chained by SubscriptionsService#organizationCurrency, which reads only the
    // currency field; the enabledModules path calls findById().exec() with no select. One
    // chainable stub covers both, so the two fakes below do not need to diverge.
    const findById = jest
      .fn()
      .mockReturnValue({ exec, select: jest.fn().mockReturnValue({ exec }) });
    const organizationModel = {
      findById,
    } as unknown as Model<OrganizationDocument>;

    const eventBus = { publish: jest.fn() } as unknown as EventBusService;

    const service = new SubscriptionsService(
      subscriptionsRepository,
      plansService,
      auditService,
      organizationModel,
      eventBus,
      // A seat count of 1 (the owner alone) keeps changePlan's new seat guard out of the way:
      // these tests are about pricing, proration and module clamping, not seats. The guard
      // itself is covered by test/seat-lifecycle.e2e-spec.ts.
      {
        countSeatsForOrganization: jest.fn().mockResolvedValue(1),
      } as never,
      // BILLING_CHARGEABLE_CURRENCIES unset: every supported currency stays chargeable, so the
      // guard never fires and these tests keep asserting what they were written for.
      { get: () => undefined } as never,
      {} as never,
      { nextFormatted: jest.fn().mockResolvedValue('ABO-0001') } as never,
    );

    return { service, update };
  }

  function makeOrg(enabledModules: string[]) {
    return { enabledModules, save: jest.fn().mockResolvedValue(undefined) };
  }

  it('G1 — free -> starter with workflow/ai enabled: both are dropped, everything else kept', async () => {
    const organization = makeOrg(['crm', 'workflow', 'ai']);
    const { service } = buildService({ plan: STARTER_PLAN, organization });

    await service.changePlan(ORG_ID, USER_ID, 'starter');

    expect(organization.enabledModules).toEqual(['crm']);
    expect(organization.save).toHaveBeenCalledTimes(1);
  });

  it('G2 — starter -> pro: no module the organization had not already chosen is auto-added', async () => {
    const organization = makeOrg(['crm', 'catalog']);
    const { service } = buildService({ plan: PRO_PLAN, organization });

    await service.changePlan(ORG_ID, USER_ID, 'pro');

    // pro allows workflow/ai too, but the organization never enabled them — must stay off.
    // Nothing was actually dropped, so no write is needed either (idempotent no-op).
    expect(organization.enabledModules).toEqual(['crm', 'catalog']);
    expect(organization.save).not.toHaveBeenCalled();
  });

  it('G3 — plan unchanged: no write when every enabled module is still allowed', async () => {
    const organization = makeOrg(['crm', 'catalog']);
    const { service } = buildService({ plan: FREE_PLAN, organization });

    await service.changePlan(ORG_ID, USER_ID, 'free');

    expect(organization.enabledModules).toEqual(['crm', 'catalog']);
    expect(organization.save).not.toHaveBeenCalled();
  });

  it('G4 — enabledModules already empty: stays empty, no write, no error', async () => {
    const organization = makeOrg([]);
    const { service } = buildService({ plan: STARTER_PLAN, organization });

    await service.changePlan(ORG_ID, USER_ID, 'starter');

    expect(organization.enabledModules).toEqual([]);
    expect(organization.save).not.toHaveBeenCalled();
  });

  it('G5 — enabledModules contains only modules the new plan still allows: kept as-is, no write', async () => {
    const organization = makeOrg(['crm', 'analytics']);
    const { service } = buildService({ plan: STARTER_PLAN, organization });

    await service.changePlan(ORG_ID, USER_ID, 'starter');

    expect(organization.enabledModules).toEqual(['crm', 'analytics']);
    expect(organization.save).not.toHaveBeenCalled();
  });

  it('does not fail the plan change itself if the organization cannot be resolved', async () => {
    const { service, update } = buildService({
      plan: STARTER_PLAN,
      organization: null,
    });

    await expect(
      service.changePlan(ORG_ID, USER_ID, 'starter'),
    ).resolves.toBeDefined();
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe('SubscriptionsService.changePlan — proration', () => {
  const ORG_ID = 'org-1';
  const USER_ID = 'user-1';

  const OLD_PLAN = {
    id: 'plan-starter',
    priceAmount: 30,
    priceCurrency: 'EUR',
  };
  const NEW_PLAN_EXPENSIVE = {
    _id: 'plan-pro',
    key: 'pro',
    modules: [],
    priceAmount: 90,
    priceCurrency: 'EUR',
  };

  function buildService(options: {
    existing: {
      planId: { toString(): string };
      currentPeriodStart: Date;
      currentPeriodEnd: Date;
    } | null;
  }) {
    const getByKey = jest.fn().mockResolvedValue(NEW_PLAN_EXPENSIVE);
    const getById = jest.fn().mockResolvedValue(OLD_PLAN);
    const plansService = { getByKey, getById } as unknown as PlansService;

    const update = jest.fn<
      Promise<{ id: string }>,
      [string, Partial<Subscription>]
    >();
    update.mockResolvedValue({ id: 'sub-1' });
    const findForOrganization = jest.fn().mockResolvedValue(options.existing);
    const subscriptionsRepository = {
      update,
      findForOrganization,
    } as unknown as SubscriptionsRepository;

    const record = jest.fn().mockResolvedValue(undefined);
    const auditService = { record } as unknown as AuditService;

    // No organization lookup needed — enabledModules sync is exercised in the describe block
    // above; NEW_PLAN_EXPENSIVE.modules is empty and findById resolves null, so that branch is
    // a no-op here.
    const exec = jest.fn().mockResolvedValue(null);
    // `.select()` is chained by SubscriptionsService#organizationCurrency, which reads only the
    // currency field; the enabledModules path calls findById().exec() with no select. One
    // chainable stub covers both, so the two fakes below do not need to diverge.
    const findById = jest
      .fn()
      .mockReturnValue({ exec, select: jest.fn().mockReturnValue({ exec }) });
    const organizationModel = {
      findById,
    } as unknown as Model<OrganizationDocument>;

    const eventBus = { publish: jest.fn() } as unknown as EventBusService;

    const service = new SubscriptionsService(
      subscriptionsRepository,
      plansService,
      auditService,
      organizationModel,
      eventBus,
      // A seat count of 1 (the owner alone) keeps changePlan's new seat guard out of the way:
      // these tests are about pricing, proration and module clamping, not seats. The guard
      // itself is covered by test/seat-lifecycle.e2e-spec.ts.
      {
        countSeatsForOrganization: jest.fn().mockResolvedValue(1),
      } as never,
      // BILLING_CHARGEABLE_CURRENCIES unset: every supported currency stays chargeable, so the
      // guard never fires and these tests keep asserting what they were written for.
      { get: () => undefined } as never,
      {} as never,
      { nextFormatted: jest.fn().mockResolvedValue('ABO-0001') } as never,
    );

    return { service, update };
  }

  it('mid-period upgrade: stores a positive prorationAmount proportional to time remaining', async () => {
    const now = Date.now();
    const { service, update } = buildService({
      existing: {
        planId: { toString: () => 'plan-starter' },
        currentPeriodStart: new Date(now - 15 * 24 * 3600 * 1000), // 15 days ago
        currentPeriodEnd: new Date(now + 15 * 24 * 3600 * 1000), // 15 days from now (~half left)
      },
    });

    await service.changePlan(ORG_ID, USER_ID, 'pro');

    const data = update.mock.calls[0]![1];
    expect(data.prorationCurrency).toBe('EUR');
    // delta = 90 - 30 = 60, ~half the period remaining -> ~30, within a day of rounding slack.
    expect(data.prorationAmount).toBeGreaterThan(25);
    expect(data.prorationAmount).toBeLessThan(35);
    expect(data.prorationCalculatedAt).toBeInstanceOf(Date);
  });

  it('no prior subscription: proration fields are stored as null', async () => {
    const { service, update } = buildService({ existing: null });

    await service.changePlan(ORG_ID, USER_ID, 'pro');

    const data = update.mock.calls[0]![1];
    expect(data.prorationAmount).toBeNull();
    expect(data.prorationCurrency).toBeNull();
    expect(data.prorationCalculatedAt).toBeNull();
  });

  it('prior period already elapsed: proration is skipped (null) rather than computed against a stale period', async () => {
    const now = Date.now();
    const { service, update } = buildService({
      existing: {
        planId: { toString: () => 'plan-starter' },
        currentPeriodStart: new Date(now - 45 * 24 * 3600 * 1000),
        currentPeriodEnd: new Date(now - 15 * 24 * 3600 * 1000), // already past
      },
    });

    await service.changePlan(ORG_ID, USER_ID, 'pro');

    const data = update.mock.calls[0]![1];
    expect(data.prorationAmount).toBeNull();
  });

  it('changePlan always clears any pending cancel-at-period-end request', async () => {
    const { service, update } = buildService({ existing: null });

    await service.changePlan(ORG_ID, USER_ID, 'pro');

    const data = update.mock.calls[0]![1];
    expect(data.cancelAtPeriodEnd).toBe(false);
    expect(data.cancelRequestedAt).toBeNull();
  });
});

describe('SubscriptionsService.cancel / reactivate', () => {
  const ORG_ID = 'org-1';
  const USER_ID = 'user-1';

  function buildService(overrides: Partial<SubscriptionsRepository> = {}) {
    const findForOrganization = jest.fn().mockResolvedValue({ id: 'sub-1' });
    const record = jest.fn().mockResolvedValue(undefined);
    const cancelNow = jest.fn();
    const requestCancelAtPeriodEnd = jest.fn();
    const reactivateIfEligible = jest.fn();
    const subscriptionsRepository = {
      findForOrganization,
      cancelNow,
      requestCancelAtPeriodEnd,
      reactivateIfEligible,
      ...overrides,
    } as unknown as SubscriptionsRepository;
    const auditService = { record } as unknown as AuditService;

    const service = new SubscriptionsService(
      subscriptionsRepository,
      {} as PlansService,
      auditService,
      {} as Model<OrganizationDocument>,
      { publish: jest.fn() } as unknown as EventBusService,
      // A seat count of 1 (the owner alone) keeps changePlan's new seat guard out of the way:
      // these tests are about pricing, proration and module clamping, not seats. The guard
      // itself is covered by test/seat-lifecycle.e2e-spec.ts.
      {
        countSeatsForOrganization: jest.fn().mockResolvedValue(1),
      } as never,
      // BILLING_CHARGEABLE_CURRENCIES unset: every supported currency stays chargeable, so the
      // guard never fires and these tests keep asserting what they were written for.
      { get: () => undefined } as never,
      {} as never,
      { nextFormatted: jest.fn().mockResolvedValue('ABO-0001') } as never,
    );

    return {
      service,
      record,
      // Returned standalone (not read back off subscriptionsRepository) so assertions bind a
      // plain jest.Mock reference rather than an object-property method access.
      cancelNow: (overrides.cancelNow ?? cancelNow) as jest.Mock,
      requestCancelAtPeriodEnd: (overrides.requestCancelAtPeriodEnd ??
        requestCancelAtPeriodEnd) as jest.Mock,
      reactivateIfEligible: (overrides.reactivateIfEligible ??
        reactivateIfEligible) as jest.Mock,
    };
  }

  it('cancel(immediate=true) calls cancelNow and audits it', async () => {
    const canceled = { id: 'sub-1', status: 'canceled' };
    const { service, record, cancelNow, requestCancelAtPeriodEnd } =
      buildService({
        cancelNow: jest.fn().mockResolvedValue(canceled),
      });

    const result = await service.cancel(ORG_ID, USER_ID, true);

    expect(result).toBe(canceled);
    expect(cancelNow).toHaveBeenCalledWith(ORG_ID);
    expect(requestCancelAtPeriodEnd).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('cancel(immediate=false) calls requestCancelAtPeriodEnd, leaving cancelNow untouched', async () => {
    const pending = { id: 'sub-1', status: 'active', cancelAtPeriodEnd: true };
    const { service, cancelNow, requestCancelAtPeriodEnd } = buildService({
      requestCancelAtPeriodEnd: jest.fn().mockResolvedValue(pending),
    });

    const result = await service.cancel(ORG_ID, USER_ID, false);

    expect(result).toBe(pending);
    expect(requestCancelAtPeriodEnd).toHaveBeenCalledWith(ORG_ID);
    expect(cancelNow).not.toHaveBeenCalled();
  });

  it('cancel throws ConflictException when the repository reports nothing eligible (already canceled)', async () => {
    const { service } = buildService({
      cancelNow: jest.fn().mockResolvedValue(null),
    });

    await expect(service.cancel(ORG_ID, USER_ID, true)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('cancel throws NotFoundException when the organization has no subscription at all', async () => {
    const { service } = buildService({
      findForOrganization: jest.fn().mockResolvedValue(null),
    });

    await expect(service.cancel(ORG_ID, USER_ID, true)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('reactivate succeeds when the repository reports an eligible subscription', async () => {
    const reactivated = {
      id: 'sub-1',
      status: 'active',
      cancelAtPeriodEnd: false,
    };
    const { service, record } = buildService({
      reactivateIfEligible: jest.fn().mockResolvedValue(reactivated),
    });

    const result = await service.reactivate(ORG_ID, USER_ID);

    expect(result).toBe(reactivated);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('reactivate throws ConflictException when nothing is eligible (already canceled, or grace window elapsed)', async () => {
    const { service } = buildService({
      reactivateIfEligible: jest.fn().mockResolvedValue(null),
    });

    await expect(service.reactivate(ORG_ID, USER_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('SubscriptionsService — 6-month and yearly plans', () => {
  const ORG_ID = new Types.ObjectId().toString();
  const USER_ID = 'user-1';
  const DAY = 86_400_000;

  const monthsLater = (from: Date, months: number) => {
    const result = new Date(from);
    result.setUTCMonth(result.getUTCMonth() + months);
    return result;
  };

  function buildService(options: {
    target: Record<string, unknown>;
    current: Record<string, unknown>;
    existing: Record<string, unknown>;
    paidCovering?: Record<string, unknown> | null;
  }) {
    const getByKey = jest.fn().mockResolvedValue(options.target);
    const plansService = {
      getByKey,
      getById: jest.fn().mockResolvedValue(options.current),
    } as unknown as PlansService;
    const update = jest
      .fn<Promise<{ id: string }>, [string, Record<string, unknown>]>()
      .mockResolvedValue({ id: 'sub-1' });
    const subscriptionsRepository = {
      update,
      findForOrganization: jest.fn().mockResolvedValue(options.existing),
    } as unknown as SubscriptionsRepository;
    const exec = jest.fn().mockResolvedValue(null);
    const organizationModel = {
      findById: jest
        .fn()
        .mockReturnValue({ exec, select: jest.fn().mockReturnValue({ exec }) }),
    } as unknown as Model<OrganizationDocument>;
    const issueForPeriod = jest
      .fn<Promise<Record<string, unknown>>, [Record<string, unknown>]>()
      .mockImplementation((data: Record<string, unknown>) =>
        Promise.resolve({ ...data, number: 'ABO-0001' }),
      );
    const invoices = {
      findPaidCovering: jest
        .fn()
        .mockResolvedValue(options.paidCovering ?? null),
      voidOpenPlanChanges: jest.fn().mockResolvedValue(0),
      issueForPeriod,
    };
    const service = new SubscriptionsService(
      subscriptionsRepository,
      plansService,
      {
        record: jest.fn().mockResolvedValue(undefined),
      } as unknown as AuditService,
      organizationModel,
      { publish: jest.fn() } as unknown as EventBusService,
      { countSeatsForOrganization: jest.fn().mockResolvedValue(1) } as never,
      { get: () => undefined } as never,
      invoices as never,
      { nextFormatted: jest.fn().mockResolvedValue('ABO-0001') } as never,
    );
    return { service, update, issueForPeriod, getByKey };
  }

  const subscriptionId = new Types.ObjectId();
  const starterMonthly = {
    _id: new Types.ObjectId(),
    key: 'starter',
    name: 'Starter',
    modules: [],
    priceAmount: 9900,
    priceCurrency: 'XOF',
    interval: 'month',
  };
  const proYearly = {
    _id: new Types.ObjectId(),
    key: 'pro',
    name: 'Pro',
    modules: [],
    priceAmount: 249000,
    priceCurrency: 'XOF',
    interval: 'year',
  };

  it('a yearly plan is asked for by duration, and its invoice covers twelve months', async () => {
    const now = new Date();
    const { service, issueForPeriod, getByKey } = buildService({
      target: proYearly,
      current: starterMonthly,
      existing: {
        _id: subscriptionId,
        id: subscriptionId.toString(),
        planId: starterMonthly._id,
        status: 'active',
        currentPeriodStart: new Date(now.getTime() - 10 * DAY),
        currentPeriodEnd: new Date(now.getTime() + 20 * DAY),
      },
    });

    const result = await service.requestPlanChange(
      ORG_ID,
      USER_ID,
      'pro',
      'year',
    );

    expect(getByKey).toHaveBeenCalledWith('pro', undefined, 'year');
    expect(result).toMatchObject({ paymentRequired: true });
    const issued = issueForPeriod.mock.calls[0]![0] as unknown as {
      amount: number;
      periodStart: Date;
      periodEnd: Date;
    };
    expect(issued.amount).toBe(249000);
    expect(issued.periodEnd.getTime()).toBe(
      monthsLater(issued.periodStart, 12).getTime(),
    );
  });

  it('opening a paid yearly plan starts a twelve-month period, with no proration against a monthly one', async () => {
    const now = new Date();
    const { service, update } = buildService({
      target: proYearly,
      current: starterMonthly,
      existing: {
        planId: starterMonthly._id,
        currentPeriodStart: new Date(now.getTime() - 10 * DAY),
        currentPeriodEnd: new Date(now.getTime() + 20 * DAY),
      },
    });

    await service.changePlan(ORG_ID, USER_ID, 'pro', { prepaid: true }, 'year');

    const data = update.mock
      .calls[0]![1] as unknown as Partial<Subscription> & {
      currentPeriodStart: Date;
      currentPeriodEnd: Date;
    };
    expect(data.currentPeriodEnd.getTime()).toBe(
      monthsLater(data.currentPeriodStart, 12).getTime(),
    );
    expect(data.prorationAmount).toBeNull();
  });

  it('refuses to throw away a prepaid year: a cheaper plan waits for the paid period to end', async () => {
    const now = new Date();
    const periodStart = new Date(now.getTime() - 30 * DAY);
    const periodEnd = monthsLater(periodStart, 12);
    const { service, issueForPeriod, update } = buildService({
      target: starterMonthly,
      current: proYearly,
      existing: {
        _id: subscriptionId,
        id: subscriptionId.toString(),
        planId: proYearly._id,
        status: 'active',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      },
      paidCovering: {
        planId: proYearly._id,
        currency: 'XOF',
        amount: 249000,
        periodStart,
        periodEnd,
      },
    });

    await expect(
      service.requestPlanChange(ORG_ID, USER_ID, 'starter', 'month'),
    ).rejects.toMatchObject({
      response: { code: 'PREPAID_PERIOD_RUNNING' },
    });
    expect(issueForPeriod).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
