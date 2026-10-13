import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PLAN_KEYS,
  PLAN_LIMITS,
  PLAN_NAMES,
  PLAN_PRICES,
  SUPPORTED_BILLING_CURRENCIES,
  modulesForPlan,
} from '@korva/types';
import { PlansRepository } from './plans.repository';
import { PlanDocument } from './schemas/plan.schema';

/** Fallback billing currency, overridable with BILLING_DEFAULT_CURRENCY. Only used when a plan
 *  lookup arrives with no currency at all (the `GET /plans` route is @SkipTenant()). */
const FALLBACK_BILLING_CURRENCY = 'EUR';

/**
 * The seed catalog: every tier, in every currency KORVA bills in.
 *
 * Derived from @korva/types/plan-tiers.ts rather than written out here. This file used to hold
 * the module lists, limits and prices directly, with a comment admitting the prices were
 * "DEMONSTRATION values", while storefront-themes.ts held a second, hand-synchronised copy of
 * the tier ranking. The two drifted: `free` ended up granting all eleven modules and `starter`
 * nine, so upgrading from free to paid REMOVED `workflow` and `ai`. plan-tiers.ts now declares a
 * minimum tier per module, which makes that shape unrepresentable.
 *
 * Every tier is now priced in all five currencies, so the old "free is the one tier seeded
 * everywhere, paid tiers only in the default currency" special case is gone with it — that rule
 * meant PlansService.list, which filters by the organization's own currency, returned nothing but
 * the free plan to every organization in XOF, MAD, USD or CAD. Côte d'Ivoire, Senegal, Morocco
 * and Canada could not buy anything at all.
 */
const DEFAULT_PLANS = PLAN_KEYS.flatMap((key) =>
  SUPPORTED_BILLING_CURRENCIES.map((currency) => ({
    key,
    name: PLAN_NAMES[key],
    priceAmount: PLAN_PRICES[currency][key],
    priceCurrency: currency,
    interval: 'month' as const,
    modules: modulesForPlan(key),
    limits: PLAN_LIMITS[key],
  })),
);

@Injectable()
export class PlansService {
  private seeded = false;

  constructor(
    private readonly plansRepository: PlansRepository,
    private readonly configService: ConfigService,
  ) {}

  /** The currency the seeded paid tiers are priced in, and the one `list()` falls back to when
   *  no organization currency is supplied. */
  defaultCurrency(): string {
    return (
      this.configService.get<string>('BILLING_DEFAULT_CURRENCY') ??
      FALLBACK_BILLING_CURRENCY
    );
  }

  /**
   * Seeds lazily on first real access rather than in OnModuleInit: an app-boot hook runs
   * once, but e2e tests call `connection.dropDatabase()` in their own beforeAll AFTER boot
   * to reset tenant isolation between files — that would silently wipe a boot-time seed with
   * nothing to repopulate it. Seeding on first access is self-healing regardless of when the
   * database gets reset. See docs/architecture-decisions.md.
   */
  /**
   * Seeds lazily on first real access rather than in OnModuleInit: an app-boot hook runs
   * once, but e2e tests call `connection.dropDatabase()` in their own beforeAll AFTER boot
   * to reset tenant isolation between files — that would silently wipe a boot-time seed with
   * nothing to repopulate it. Seeding on first access is self-healing regardless of when the
   * database gets reset. See docs/architecture-decisions.md.
   *
   * `upsertByKeyAndCurrency` is $setOnInsert, so this only ever CREATES. It will not repair a
   * database that already holds the old defective catalog — that is what
   * migrations/0003-plan-catalog-realignment.ts is for.
   */
  private async ensureSeeded(): Promise<void> {
    if (this.seeded) return;
    for (const plan of DEFAULT_PLANS) {
      await this.plansRepository.upsertByKeyAndCurrency(
        plan.key,
        plan.priceCurrency,
        plan,
      );
    }
    this.seeded = true;
  }

  /**
   * The plans sellable in one currency — the organization's own `currency`, so a tenant is never
   * shown a price it cannot be charged in. Falls back to the default billing currency when no
   * organization context exists (the route is @SkipTenant()).
   */
  async list(currency?: string): Promise<PlanDocument[]> {
    await this.ensureSeeded();
    return this.plansRepository.findAllForCurrency(
      currency ?? this.defaultCurrency(),
    );
  }

  /**
   * One tier in one currency. The currency is part of the identity, not a detail: asking for
   * "starter" without saying which currency has no single answer once a tier is priced in more
   * than one, and picking arbitrarily would sell someone a plan in a currency their PSP cannot
   * charge.
   */
  async getByKey(key: string, currency?: string): Promise<PlanDocument> {
    await this.ensureSeeded();
    const priceCurrency = currency ?? this.defaultCurrency();
    const plan = await this.plansRepository.findByKeyAndCurrency(
      key,
      priceCurrency,
    );
    if (!plan) {
      throw new NotFoundException({
        code: 'PLAN_NOT_FOUND',
        message: `Plan "${key}" is not available in ${priceCurrency}`,
        details: { key, currency: priceCurrency },
      });
    }
    return plan;
  }

  async getById(id: string): Promise<PlanDocument> {
    await this.ensureSeeded();
    const plan = await this.plansRepository.findById(id);
    if (!plan) {
      throw new NotFoundException({
        code: 'PLAN_NOT_FOUND',
        message: 'Plan not found',
      });
    }
    return plan;
  }
}
