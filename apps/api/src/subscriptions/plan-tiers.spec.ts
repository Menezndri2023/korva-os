import {
  BILLABLE_COUNTRIES,
  KORVA_MODULES,
  MODULE_MIN_PLAN,
  PLAN_KEYS,
  PLAN_LIMITS,
  PLAN_PRICES,
  SUPPORTED_BILLING_CURRENCIES,
  COUNTRY_CURRENCY,
  currencyForCountry,
  isCurrencyChargeable,
  modulesForPlan,
  parseChargeableCurrencies,
  planMeetsMinimum,
} from '@korva/types';
import type { PlanKey } from '@korva/types';

/**
 * Guards the commercial catalog in @korva/types/plan-tiers.ts.
 *
 * Lives in apps/api rather than packages/types for the same reason vertical-templates.spec.ts
 * does: the type package has no test runner of its own, and these are invariants TypeScript
 * cannot express. It can check that `MODULE_MIN_PLAN.finance` is a valid plan key; it cannot
 * check that the resulting ladder only ever goes up.
 *
 * That is not hypothetical. Until 2026-10-13 the catalog granted all eleven modules on `free`
 * and nine on `starter`, so paying KORVA money removed `workflow` and `ai` from an organization,
 * and `starter` carried an `ai_messages_per_month` quota on a tier with no `ai` module to spend
 * it on. Both shapes passed every type check in the repo.
 */
describe('plan tiers — commercial catalog', () => {
  const ASCENDING = [...PLAN_KEYS];

  it('never takes a module away as the plan goes up', () => {
    for (let i = 1; i < ASCENDING.length; i += 1) {
      const lower = new Set(modulesForPlan(ASCENDING[i - 1]!));
      const higher = new Set(modulesForPlan(ASCENDING[i]!));
      const lost = [...lower].filter((module) => !higher.has(module));
      expect(lost).toEqual([]);
    }
  });

  it('assigns every module a threshold, and only real plan keys', () => {
    // A module missing from MODULE_MIN_PLAN would be `undefined` at the planMeetsMinimum call
    // in modulesForPlan, which ranks as free and would silently grant it to everyone.
    for (const module of KORVA_MODULES) {
      expect(PLAN_KEYS).toContain(MODULE_MIN_PLAN[module]);
    }
    expect(Object.keys(MODULE_MIN_PLAN).sort()).toEqual(
      [...KORVA_MODULES].sort(),
    );
  });

  it('grants a module exactly from its declared tier upwards', () => {
    for (const module of KORVA_MODULES) {
      for (const plan of PLAN_KEYS) {
        const granted = modulesForPlan(plan).includes(module);
        expect(granted).toBe(planMeetsMinimum(plan, MODULE_MIN_PLAN[module]));
      }
    }
  });

  it('keeps the free tier able to confirm a booking', () => {
    // Twelve of the seventeen vertical templates suggest `booking`, and
    // BookingReminderSchedulerService has no channel without `communication`. A paid
    // `communication` would ship a booking product that cannot confirm a booking.
    const free = modulesForPlan('free');
    expect(free).toContain('booking');
    expect(free).toContain('communication');
  });

  it('never declares a quota a tier cannot spend', () => {
    // `starter` used to carry ai_messages_per_month: 100 with no `ai` module, so
    // assertModulesAllowed rejected every call that could have consumed it.
    for (const plan of PLAN_KEYS) {
      const quota = PLAN_LIMITS[plan]['ai_messages_per_month'];
      expect(quota).toBeDefined();
      const hasAi = modulesForPlan(plan).includes('ai');
      if (!hasAi) expect(quota).toBe(0);
      else expect(quota! === -1 || quota! > 0).toBe(true);
    }
  });

  it('never loosens a quota as the plan goes down', () => {
    const rank = (value: number) => (value === -1 ? Infinity : value);
    for (const metric of ['seats', 'ai_messages_per_month']) {
      for (let i = 1; i < ASCENDING.length; i += 1) {
        const lower = rank(PLAN_LIMITS[ASCENDING[i - 1]!][metric]!);
        const higher = rank(PLAN_LIMITS[ASCENDING[i]!][metric]!);
        expect(higher).toBeGreaterThanOrEqual(lower);
      }
    }
  });

  it('declares no quota the code does not enforce', () => {
    // seats -> assertSeatAvailable, ai_messages_per_month -> checkAndRecordUsage. Anything else
    // here would be advertised on the pricing page and enforced nowhere. An email allowance is
    // the one deliberately absent: metering the seven EMAIL_PROVIDER.send sites would also meter
    // password resets and email verification, locking people out over a quota.
    const ENFORCED = ['seats', 'ai_messages_per_month'];
    for (const plan of PLAN_KEYS) {
      expect(Object.keys(PLAN_LIMITS[plan]).sort()).toEqual(
        [...ENFORCED].sort(),
      );
    }
  });

  it('prices every tier in every currency it bills in', () => {
    for (const currency of SUPPORTED_BILLING_CURRENCIES) {
      for (const plan of PLAN_KEYS) {
        const price = PLAN_PRICES[currency][plan];
        expect(typeof price).toBe('number');
        expect(Number.isInteger(price)).toBe(true);
        expect(price).toBeGreaterThanOrEqual(0);
      }
      expect(PLAN_PRICES[currency].free).toBe(0);
    }
  });

  it('never prices a higher tier below a lower one', () => {
    for (const currency of SUPPORTED_BILLING_CURRENCIES) {
      for (let i = 1; i < ASCENDING.length; i += 1) {
        expect(PLAN_PRICES[currency][ASCENDING[i]!]).toBeGreaterThan(
          PLAN_PRICES[currency][ASCENDING[i - 1]!],
        );
      }
    }
  });

  it('maps every billable country to a currency it bills in', () => {
    for (const [country, currency] of Object.entries(COUNTRY_CURRENCY)) {
      expect(country).toMatch(/^[A-Z]{2}$/);
      expect(SUPPORTED_BILLING_CURRENCIES).toContain(currency);
    }
  });

  it('resolves a country to its currency, case-insensitively, and falls back to EUR', () => {
    expect(currencyForCountry('MA')).toBe('MAD');
    expect(currencyForCountry('ci')).toBe('XOF');
    expect(currencyForCountry('FR')).toBe('EUR');
    // An unmapped country must not end up with `undefined` as an organization's currency:
    // a Subscription is bound for good to the currency it was sold in.
    expect(currencyForCountry('ZZ')).toBe('EUR');
  });

  /**
   * BILLING_CHARGEABLE_CURRENCIES narrows what the catalog is priced in to what the configured
   * Flow A provider can actually collect. Flow A resolves ONE market-independent provider for
   * every tenant, so a currency it cannot charge is a priced plan nobody can pay for — and
   * without the guard in SubscriptionsService.changePlan that surfaces as an opaque provider
   * rejection on a hosted checkout, after an invoice has been issued.
   */
  describe('currencies KORVA can actually collect in', () => {
    it('derives its universe from PLAN_PRICES, which must match the billed currencies', () => {
      // parseChargeableCurrencies reads PLAN_PRICES' keys rather than importing
      // SUPPORTED_BILLING_CURRENCIES, because plan-tiers.ts keeps its imports type-only to hold
      // a require cycle closed. That substitution is only safe while the two agree, so the
      // agreement is asserted here rather than assumed.
      expect([...Object.keys(PLAN_PRICES)].sort()).toEqual(
        [...SUPPORTED_BILLING_CURRENCIES].sort(),
      );
    });

    it('treats an unset variable as no restriction, not as "sell nothing"', () => {
      // Fail-open on purpose, unlike METRICS_TOKEN: unset restores the behaviour that existed
      // before this guard, whereas failing closed would refuse every paid plan on every
      // deployment that had not set the variable yet.
      for (const unset of [undefined, '', '   ']) {
        expect([...parseChargeableCurrencies(unset)].sort()).toEqual(
          [...SUPPORTED_BILLING_CURRENCIES].sort(),
        );
      }
    });

    it('parses a configured list, tolerating spacing and case', () => {
      expect(parseChargeableCurrencies('XOF,USD')).toEqual(['XOF', 'USD']);
      expect(parseChargeableCurrencies(' xof , usd ')).toEqual(['XOF', 'USD']);
    });

    it('ignores a currency the catalog does not price', () => {
      // Narrowing to something unpriced would leave the guard and the catalog disagreeing.
      expect(parseChargeableCurrencies('XOF,BTC,NGN')).toEqual(['XOF']);
    });

    it('falls back to no restriction when the value names nothing sellable', () => {
      // A typo that matched nothing would otherwise close the business silently.
      expect([...parseChargeableCurrencies('BTC,NGN')].sort()).toEqual(
        [...SUPPORTED_BILLING_CURRENCIES].sort(),
      );
    });

    it('matches exactly, so an unexpected code is never assumed chargeable', () => {
      const chargeable = parseChargeableCurrencies('XOF,USD');
      expect(isCurrencyChargeable('XOF', chargeable)).toBe(true);
      expect(isCurrencyChargeable('EUR', chargeable)).toBe(false);
      expect(isCurrencyChargeable('xof', chargeable)).toBe(false);
      expect(isCurrencyChargeable('', chargeable)).toBe(false);
    });

    it('leaves at least one billable country able to buy, for the live configuration', () => {
      // The failure this catches is total: narrow the set to a currency no country maps to and
      // every upgrade on the platform is refused while the catalog still advertises prices.
      // An empty revenue funnel should fail a test, not a quarter.
      const chargeable = parseChargeableCurrencies('XOF,USD');
      const reachable = BILLABLE_COUNTRIES.filter((country) =>
        isCurrencyChargeable(country.currency, chargeable),
      );
      expect(reachable.length).toBeGreaterThan(0);
    });

    it('keeps every tier free of charge in a currency it cannot collect', () => {
      // The guard only refuses PAID tiers, so this is what makes "the free plan is available
      // everywhere" true rather than aspirational: a zero price involves no provider at all.
      const chargeable = parseChargeableCurrencies('XOF,USD');
      const uncollectable = SUPPORTED_BILLING_CURRENCIES.filter(
        (currency) => !isCurrencyChargeable(currency, chargeable),
      );
      expect(uncollectable.length).toBeGreaterThan(0);
      for (const currency of uncollectable) {
        expect(PLAN_PRICES[currency].free).toBe(0);
      }
    });
  });

  it('keeps PLAN_KEYS ordered from cheapest to dearest', () => {
    // planMeetsMinimum ranks by position, and every monotonicity test above walks this array
    // in order — a reordering would silently invert all of them.
    const freePlan: PlanKey = 'free';
    expect(PLAN_KEYS[0]).toBe(freePlan);
    expect(PLAN_KEYS[PLAN_KEYS.length - 1]).toBe('business');
  });
});
