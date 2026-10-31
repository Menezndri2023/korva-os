import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import {
  PLAN_KEYS,
  PLAN_PRICES,
  SUPPORTED_BILLING_CURRENCIES,
} from '@korva/types';
import { PlansService } from './plans.service';
import type { PlansRepository } from './plans.repository';

/**
 * Multi-currency plan catalog: a tier is one Plan document per currency, and an organization is
 * only ever shown — and only ever sold — the tier priced in its own currency.
 */
function buildPlansService(
  options: { defaultCurrency?: string; found?: unknown } = {},
) {
  const seeded: { key: string; currency: string; amount: number }[] = [];
  const plansRepository = {
    upsertByKeyAndCurrency: jest
      .fn()
      .mockImplementation(
        (key: string, priceCurrency: string, data: { priceAmount: number }) => {
          seeded.push({
            key,
            currency: priceCurrency,
            amount: data.priceAmount,
          });
          return Promise.resolve({ key, priceCurrency });
        },
      ),
    findAllForCurrency: jest.fn().mockResolvedValue([]),
    findByKeyAndCurrency: jest
      .fn()
      .mockResolvedValue(options.found === undefined ? null : options.found),
  };
  const configService = {
    get: jest
      .fn()
      .mockImplementation((key: string) =>
        key === 'BILLING_DEFAULT_CURRENCY'
          ? options.defaultCurrency
          : undefined,
      ),
  } as unknown as ConfigService;

  const service = new PlansService(
    plansRepository as unknown as PlansRepository,
    configService,
  );
  return { service, plansRepository, seeded };
}

describe('PlansService — multi-currency catalog', () => {
  it('seeds the free tier in EVERY supported currency', async () => {
    const h = buildPlansService();

    await h.service.list();

    const freeCurrencies = h.seeded
      .filter((p) => p.key === 'free')
      .map((p) => p.currency)
      .sort();
    // Not generosity: createDefaultSubscription looks up ('free', the org's own currency), so an
    // organization created in a currency with no free plan could not be created at all.
    expect(freeCurrencies).toEqual([...SUPPORTED_BILLING_CURRENCIES].sort());
    for (const plan of h.seeded.filter((p) => p.key === 'free')) {
      expect(plan.amount).toBe(0);
    }
  });

  /**
   * This replaces a test that asserted the opposite — "seeds paid tiers only in the default
   * currency". That rule was not a safeguard, it was the bug: PlansService.list filters by the
   * organization's own currency, so seeding paid tiers in EUR alone meant every organization in
   * XOF, MAD, USD or CAD was offered the free plan and nothing else. Côte d'Ivoire, Senegal,
   * Morocco and Canada could not buy anything.
   */
  it('seeds EVERY tier in EVERY supported currency — each market has something to buy', async () => {
    const h = buildPlansService();

    await h.service.list();

    for (const key of PLAN_KEYS) {
      const currencies = h.seeded
        .filter((p) => p.key === key)
        .map((p) => p.currency)
        .sort();
      expect(currencies).toEqual([...SUPPORTED_BILLING_CURRENCIES].sort());
    }
  });

  it('takes every price from the declared catalog, never converting one', async () => {
    const h = buildPlansService();

    await h.service.list();

    // The point of asserting this rather than a few literals: a price must come from
    // PLAN_PRICES, which is set per market. Deriving MAD or XOF from EUR at an exchange rate
    // would price KORVA out of its primary market (29 EUR is 19 023 XOF — see plan-tiers.ts).
    expect(h.seeded.length).toBe(
      PLAN_KEYS.length * SUPPORTED_BILLING_CURRENCIES.length,
    );
    for (const seeded of h.seeded) {
      const expected =
        PLAN_PRICES[seeded.currency as keyof typeof PLAN_PRICES][
          seeded.key as (typeof PLAN_KEYS)[number]
        ];
      expect(seeded.amount).toBe(expected);
    }
  });

  it('does not let BILLING_DEFAULT_CURRENCY change what gets seeded', async () => {
    const h = buildPlansService({ defaultCurrency: 'XOF' });

    await h.service.list();

    // It used to decide which currency the paid tiers existed in at all. Now every tier is
    // priced everywhere, so this setting only picks the fallback for a lookup that arrives
    // without a currency (the GET /plans route is @SkipTenant) — covered by the test below.
    for (const key of PLAN_KEYS) {
      const currencies = h.seeded
        .filter((p) => p.key === key)
        .map((p) => p.currency)
        .sort();
      expect(currencies).toEqual([...SUPPORTED_BILLING_CURRENCIES].sort());
    }
  });

  it('lists only the plans priced in the requested currency', async () => {
    const h = buildPlansService();

    await h.service.list('XOF');

    expect(h.plansRepository.findAllForCurrency).toHaveBeenCalledWith('XOF');
  });

  it('falls back to the default currency when none is given', async () => {
    const h = buildPlansService({ defaultCurrency: 'MAD' });

    await h.service.list();

    expect(h.plansRepository.findAllForCurrency).toHaveBeenCalledWith('MAD');
  });

  it('refuses a tier that has no price in the requested currency, naming the currency', async () => {
    const h = buildPlansService({ found: null });

    await expect(h.service.getByKey('pro', 'XOF')).rejects.toThrow(
      NotFoundException,
    );
    // "Not priced here yet" and "does not exist" are the same answer to a tenant, by design —
    // you only sell where a price was decided — but the error must say which currency.
    await expect(h.service.getByKey('pro', 'XOF')).rejects.toMatchObject({
      response: { details: { key: 'pro', currency: 'XOF' } },
    });
  });
});

/** The monetization gate on self-service product overrides. */
describe('SubscriptionsService — product overrides stay within the plan', () => {
  const ORG = new Types.ObjectId().toString();

  async function build(planModules: string[]) {
    const { SubscriptionsService } = await import('./subscriptions.service');
    const subscription = {
      id: 'sub-1',
      planId: new Types.ObjectId(),
      productOverrides: undefined,
    };
    const update = jest
      .fn()
      .mockResolvedValue({ ...subscription, id: 'sub-1' });
    const service = new SubscriptionsService(
      {
        findForOrganization: jest.fn().mockResolvedValue(subscription),
        update,
      } as never,
      {
        getById: jest.fn().mockResolvedValue({
          key: 'free',
          name: 'Free',
          modules: planModules,
          priceCurrency: 'EUR',
        }),
      } as never,
      { record: jest.fn().mockResolvedValue(undefined) } as never,
      {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
          select: jest
            .fn()
            .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
        }),
      } as never,
      { publish: jest.fn() } as never,
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

  it('rejects granting a product whose modules the plan does not include', async () => {
    // "starter" excludes ai; granting the ai product would be a free add-on, since no
    // per-product price exists anywhere in the model.
    const h = await build(['crm', 'catalog', 'finance']);

    await expect(
      h.service.updateProductOverrides(ORG, 'user-1', { ai: true }),
    ).rejects.toThrow(ForbiddenException);
    expect(h.update).not.toHaveBeenCalled();
  });

  it('allows granting a product the plan already covers — the override then changes nothing', async () => {
    const h = await build(['ai']);

    await expect(
      h.service.updateProductOverrides(ORG, 'user-1', { ai: true }),
    ).resolves.toBeDefined();
  });

  it('always allows switching a product OFF — restricting its own access is the tenant’s call', async () => {
    const h = await build(['crm', 'catalog', 'finance']);

    await expect(
      h.service.updateProductOverrides(ORG, 'user-1', { ai: false }),
    ).resolves.toBeDefined();
  });
});
