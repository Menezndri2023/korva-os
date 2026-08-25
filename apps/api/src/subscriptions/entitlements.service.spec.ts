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

    const countForOrganization = jest.fn().mockResolvedValue(1);
    const membershipsService = {
      countForOrganization,
    } as unknown as MembershipsService;

    const service = new EntitlementsService(
      subscriptionsService,
      usageRepository,
      membershipsService,
    );

    return { service, getActivePlan, increment, countForOrganization };
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
      const { service, countForOrganization } = buildService('canceled');

      await expectForbiddenCode(
        service.assertSeatAvailable(ORG_ID),
        'SUBSCRIPTION_CANCELED',
      );
      // Never even needs to count members — the subscription check short-circuits first.
      expect(countForOrganization).not.toHaveBeenCalled();
    });

    it('still allows adding a seat when active and under the limit', async () => {
      const { service } = buildService('active');
      await expect(
        service.assertSeatAvailable(ORG_ID),
      ).resolves.toBeUndefined();
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
