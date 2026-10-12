import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { KorvaModule } from '@korva/types';
import { KORVA_MODULES, SUPPORTED_BILLING_CURRENCIES } from '@korva/types';
import { PlansRepository } from './plans.repository';
import { PlanDocument } from './schemas/plan.schema';

const ALL_MODULES = [...KORVA_MODULES] as KorvaModule[];
const STARTER_MODULES = ALL_MODULES.filter(
  (m) => m !== 'workflow' && m !== 'ai',
);

/** Fallback billing currency for the seeded paid tiers, overridable with
 *  BILLING_DEFAULT_CURRENCY. EUR keeps the pre-multi-currency values exactly as they were. */
const FALLBACK_BILLING_CURRENCY = 'EUR';

/**
 * Default plan catalog. Every new organization starts on "free": deliberately generous
 * (every module, small-but-usable limits) so onboarding never breaks for an org that hasn't
 * chosen a paid plan yet. "starter" exists specifically to demonstrate real module-tier
 * restrictions (excludes workflow/ai).
 *
 * These prices are DEMONSTRATION values, not a commercial decision — real prices are set per
 * currency with scripts/manage-plans.ts. They are seeded only in the default billing currency;
 * see ensureSeeded for why "free" is the one exception.
 */
const DEFAULT_PLANS = [
  {
    key: 'free',
    name: 'Free',
    priceAmount: 0,
    priceCurrency: 'EUR',
    interval: 'month' as const,
    modules: ALL_MODULES,
    limits: { seats: 3, ai_messages_per_month: 5 },
  },
  {
    key: 'starter',
    name: 'Starter',
    priceAmount: 29,
    priceCurrency: 'EUR',
    interval: 'month' as const,
    modules: STARTER_MODULES,
    limits: { seats: 10, ai_messages_per_month: 100 },
  },
  {
    key: 'pro',
    name: 'Pro',
    priceAmount: 99,
    priceCurrency: 'EUR',
    interval: 'month' as const,
    modules: ALL_MODULES,
    limits: { seats: 25, ai_messages_per_month: 1000 },
  },
  {
    key: 'business',
    name: 'Business',
    priceAmount: 299,
    priceCurrency: 'EUR',
    interval: 'month' as const,
    modules: ALL_MODULES,
    limits: { seats: -1, ai_messages_per_month: -1 },
  },
];

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
  private async ensureSeeded(): Promise<void> {
    if (this.seeded) return;
    const defaultCurrency = this.defaultCurrency();
    for (const plan of DEFAULT_PLANS) {
      if (plan.priceAmount === 0) {
        // "free" is seeded in EVERY supported currency, and must be: an organization's default
        // subscription is looked up as (key 'free', the org's own currency), so an organization
        // created in a currency with no free plan could not be created at all. A price of 0 is
        // the same in every currency, so there is no commercial judgment being made here —
        // unlike the paid tiers below.
        for (const currency of SUPPORTED_BILLING_CURRENCIES) {
          await this.plansRepository.upsertByKeyAndCurrency(
            plan.key,
            currency,
            {
              ...plan,
              priceCurrency: currency,
            },
          );
        }
        continue;
      }
      // Paid tiers are seeded ONLY in the default currency. Inventing a price for XOF or MAD
      // would be a commercial decision disguised as a default; a tier with no price in a
      // currency is simply not sold there until someone sets one via manage-plans.ts.
      await this.plansRepository.upsertByKeyAndCurrency(
        plan.key,
        defaultCurrency,
        { ...plan, priceCurrency: defaultCurrency },
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
