import { ForbiddenException } from '@nestjs/common';
import { EntitlementsService } from './entitlements.service';
import type { SubscriptionsService } from './subscriptions.service';
import type { UsageRepository } from './usage.repository';
import type { MembershipsService } from '../identity/memberships/memberships.service';

/**
 * Wave 3 fix: EntitlementsService must block the consuming/growing checks (module enablement,
 * seat addition, usage recording) once `subscription.status === 'canceled'` — see the reasoning
 * documented on EntitlementsService itself. Before this fix, none of these methods ever looked
 * at `status` at all, so a canceled organization retained every entitlement of its last plan.
 */
describe('EntitlementsService — subscription status enforcement', () => {
  const ORG_ID = 'org-1';

  const PLAN = {
    key: 'pro',
    name: 'Pro',
    modules: ['crm', 'catalog', 'ai'],
    limits: { seats: 10, ai_messages_per_month: 100 },
  };

  function buildService(subscriptionStatus: 'active' | 'canceled') {
    const getForOrganization = jest
      .fn()
      .mockResolvedValue({ status: subscriptionStatus });
    const getActivePlan = jest.fn().mockResolvedValue(PLAN);
    const subscriptionsService = {
      getForOrganization,
      getActivePlan,
    } as unknown as SubscriptionsService;

    const getCount = jest.fn().mockResolvedValue(0);
    const increment = jest.fn().mockResolvedValue(1);
    const usageRepository = {
      getCount,
      increment,
    } as unknown as UsageRepository;

    const countSeatsForOrganization = jest.fn().mockResolvedValue(1);
    const membershipsService = {
      countSeatsForOrganization,
    } as unknown as MembershipsService;

    const service = new EntitlementsService(
      subscriptionsService,
      usageRepository,
      membershipsService,
      {} as never,
    );

    return { service, getActivePlan, increment, countSeatsForOrganization };
  }

  /** Awaits `promise`, asserting it rejects with a ForbiddenException carrying `code`. */
  async function expectForbiddenCode(
    promise: Promise<unknown>,
    code: string,
  ): Promise<void> {
    await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
    try {
      await promise;
      throw new Error('expected promise to reject');
    } catch (error) {
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code,
      });
    }
  }

  describe('assertModulesAllowed', () => {
    it('rejects with SUBSCRIPTION_CANCELED when the subscription is canceled, before ever consulting the plan', async () => {
      const { service, getActivePlan } = buildService('canceled');

      await expectForbiddenCode(
        service.assertModulesAllowed(ORG_ID, ['crm']),
        'SUBSCRIPTION_CANCELED',
      );
      expect(getActivePlan).not.toHaveBeenCalled();
    });

    it('still applies the normal MODULE_NOT_IN_PLAN check when the subscription is active', async () => {
      const { service } = buildService('active');

      await expectForbiddenCode(
        service.assertModulesAllowed(ORG_ID, ['workflow']),
        'MODULE_NOT_IN_PLAN',
      );
    });

    it('allows a module the plan includes when the subscription is active', async () => {
      const { service } = buildService('active');
      await expect(
        service.assertModulesAllowed(ORG_ID, ['crm']),
      ).resolves.toBeUndefined();
    });
  });

  describe('assertSeatAvailable', () => {
    it('rejects with SUBSCRIPTION_CANCELED when canceled, even with seats free under the plan limit', async () => {
      const { service, countSeatsForOrganization } = buildService('canceled');

      await expectForbiddenCode(
        service.assertSeatAvailable(ORG_ID),
        'SUBSCRIPTION_CANCELED',
      );
      // Never even needs to count members — the subscription check short-circuits first.
      expect(countSeatsForOrganization).not.toHaveBeenCalled();
    });

    it('still allows adding a seat when active and under the limit', async () => {
      const { service } = buildService('active');
      await expect(
        service.assertSeatAvailable(ORG_ID),
      ).resolves.toBeUndefined();
    });
  });

  describe('assertStorefrontThemeAllowed', () => {
    function buildServiceWithPlan(planKey: string) {
      const getForOrganization = jest
        .fn()
        .mockResolvedValue({ status: 'active' });
      const getActivePlan = jest.fn().mockResolvedValue({
        key: planKey,
        name: planKey,
        modules: [],
        limits: {},
      });
      const subscriptionsService = {
        getForOrganization,
        getActivePlan,
      } as unknown as SubscriptionsService;
      const usageRepository = {} as unknown as UsageRepository;
      const membershipsService = {} as unknown as MembershipsService;

      return new EntitlementsService(
        subscriptionsService,
        usageRepository,
        membershipsService,
        {} as never,
      );
    }

    it('does nothing when the update touches no template (e.g. a caller resolved no effective template)', async () => {
      const service = buildServiceWithPlan('free');
      await expect(
        service.assertStorefrontThemeAllowed(ORG_ID, {}),
      ).resolves.toBeUndefined();
    });

    it('allows "essentiel" on the free plan', async () => {
      const service = buildServiceWithPlan('free');
      await expect(
        service.assertStorefrontThemeAllowed(ORG_ID, { template: 'essentiel' }),
      ).resolves.toBeUndefined();
    });

    it('allows a sector template on the free plan, on its first preset only', async () => {
      // This asserted the opposite until 2026-10-13, when the five sector templates were made
      // free: all seventeen vertical templates default to one of them, so a free organization
      // always fell back to "essentiel" and every trade rendered the same generic site. The
      // gate itself did not move — it is `refinedChoiceMinPlan` that still holds the line, so
      // a free organization gets `boutique` on palettes[0]/fontPairings[0] and nothing else.
      const service = buildServiceWithPlan('free');
      await expect(
        service.assertStorefrontThemeAllowed(ORG_ID, {
          template: 'boutique',
          palette: 'marine',
          fontPairing: 'geometrique',
        }),
      ).resolves.toBeUndefined();

      await expectForbiddenCode(
        service.assertStorefrontThemeAllowed(ORG_ID, {
          template: 'boutique',
          palette: 'corail',
        }),
        'STOREFRONT_PALETTE_NOT_IN_PLAN',
      );
    });

    it('allows a sector template on starter, but only its default palette/font pairing', async () => {
      const service = buildServiceWithPlan('starter');
      await expect(
        service.assertStorefrontThemeAllowed(ORG_ID, {
          template: 'boutique',
          palette: 'marine',
          fontPairing: 'geometrique',
        }),
      ).resolves.toBeUndefined();

      await expectForbiddenCode(
        service.assertStorefrontThemeAllowed(ORG_ID, {
          template: 'boutique',
          palette: 'corail',
        }),
        'STOREFRONT_PALETTE_NOT_IN_PLAN',
      );
      await expectForbiddenCode(
        service.assertStorefrontThemeAllowed(ORG_ID, {
          template: 'boutique',
          fontPairing: 'sobre',
        }),
        'STOREFRONT_FONT_PAIRING_NOT_IN_PLAN',
      );
    });

    it("allows any of the template's palettes/font pairings on pro", async () => {
      const service = buildServiceWithPlan('pro');
      await expect(
        service.assertStorefrontThemeAllowed(ORG_ID, {
          template: 'boutique',
          palette: 'corail',
          fontPairing: 'sobre',
        }),
      ).resolves.toBeUndefined();
    });

    it('rejects an unrecognized plan key as the lowest tier — fails closed, never grants access', async () => {
      // Aimed at refinedChoiceMinPlan ("pro") rather than a template's minPlan: every template
      // is reachable from free now, so a template no longer proves anything about ranking. The
      // invariant under test is unchanged and is the one that matters — planMeetsMinimum ranks
      // a plan key it does not recognise as the LOWEST tier, so a corrupt or renamed plan
      // grants the least, never the most.
      const service = buildServiceWithPlan('mystery-plan');
      await expectForbiddenCode(
        service.assertStorefrontThemeAllowed(ORG_ID, {
          template: 'vitrine',
          palette: 'sauge',
        }),
        'STOREFRONT_PALETTE_NOT_IN_PLAN',
      );
    });
  });

  describe('checkAndRecordUsage', () => {
    it('rejects with SUBSCRIPTION_CANCELED when canceled, without recording any usage', async () => {
      const { service, increment } = buildService('canceled');

      await expectForbiddenCode(
        service.checkAndRecordUsage(ORG_ID, 'ai_messages_per_month'),
        'SUBSCRIPTION_CANCELED',
      );
      expect(increment).not.toHaveBeenCalled();
    });

    it('still records usage normally when active and under quota', async () => {
      const { service, increment } = buildService('active');
      await expect(
        service.checkAndRecordUsage(ORG_ID, 'ai_messages_per_month'),
      ).resolves.toBeUndefined();
      expect(increment).toHaveBeenCalledTimes(1);
    });
  });
});
