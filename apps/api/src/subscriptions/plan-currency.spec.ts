import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { SUPPORTED_BILLING_CURRENCIES } from '@korva/types';
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

  it('seeds paid tiers only in the default currency — a price is never invented for a market', async () => {
    const h = buildPlansService();

    await h.service.list();

    const paid = h.seeded.filter((p) => p.amount > 0);
    expect(paid.length).toBeGreaterThan(0);
    expect(new Set(paid.map((p) => p.currency))).toEqual(new Set(['EUR']));
  });

  it('honours BILLING_DEFAULT_CURRENCY for the paid tiers', async () => {
    const h = buildPlansService({ defaultCurrency: 'XOF' });

    await h.service.list();

    expect(
      new Set(h.seeded.filter((p) => p.amount > 0).map((p) => p.currency)),
    ).toEqual(new Set(['XOF']));
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
