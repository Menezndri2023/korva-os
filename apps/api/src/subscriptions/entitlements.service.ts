import { ForbiddenException, Injectable } from '@nestjs/common';
import type { KorvaModule, UsageSummaryItem } from '@korva/types';
import { SubscriptionsService } from './subscriptions.service';
import { UsageRepository } from './usage.repository';
import { MembershipsService } from '../identity/memberships/memberships.service';

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7); // "YYYY-MM"
}

/**
 * Single source of truth for "can this organization do X?" — every check here is derived
 * from the organization's active Subscription/Plan, never hardcoded. See docs/ai.md and
 * docs/IMPLEMENTATION_PLAN.md Phase 10.
 */
@Injectable()
export class EntitlementsService {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly usageRepository: UsageRepository,
    private readonly membershipsService: MembershipsService,
  ) {}

  async assertModulesAllowed(
    organizationId: string,
    requestedModules: KorvaModule[],
  ): Promise<void> {
    const plan = await this.subscriptionsService.getActivePlan(organizationId);
    const notAllowed = requestedModules.filter(
      (m) => !plan.modules.includes(m),
    );
    if (notAllowed.length > 0) {
      throw new ForbiddenException({
        code: 'MODULE_NOT_IN_PLAN',
        message: `Your plan ("${plan.name}") does not include: ${notAllowed.join(', ')}`,
        details: { modules: notAllowed, plan: plan.key },
      });
    }
  }

  async assertSeatAvailable(organizationId: string): Promise<void> {
    const plan = await this.subscriptionsService.getActivePlan(organizationId);
    const limit = plan.limits.seats ?? -1;
    if (limit === -1) return;

    const count =
      await this.membershipsService.countForOrganization(organizationId);
    if (count >= limit) {
      throw new ForbiddenException({
        code: 'SEAT_LIMIT_REACHED',
        message: `Your plan ("${plan.name}") allows up to ${limit} team members`,
        details: { limit, used: count },
      });
    }
  }

  /** Throws if the metric's monthly quota is already reached, otherwise records one unit of usage. */
  async checkAndRecordUsage(
    organizationId: string,
    metric: string,
  ): Promise<void> {
    const plan = await this.subscriptionsService.getActivePlan(organizationId);
    const limit = plan.limits[metric] ?? -1;
    const period = currentPeriod();

    if (limit !== -1) {
      const used = await this.usageRepository.getCount(
        organizationId,
        metric,
        period,
      );
      if (used >= limit) {
        throw new ForbiddenException({
          code: 'USAGE_LIMIT_REACHED',
          message: `Your plan ("${plan.name}") allows up to ${limit} "${metric}" per month`,
          details: { metric, limit, used },
        });
      }
    }

    await this.usageRepository.increment(organizationId, metric, period);
  }

  async getSummary(organizationId: string) {
    const subscription =
      await this.subscriptionsService.getForOrganization(organizationId);
    const plan = await this.subscriptionsService.getActivePlan(organizationId);
    const usage = await this.getUsageSummary(organizationId);
    return { subscription, plan, usage };
  }

  async getUsageSummary(organizationId: string): Promise<UsageSummaryItem[]> {
    const plan = await this.subscriptionsService.getActivePlan(organizationId);
    const period = currentPeriod();

    return Promise.all(
      Object.entries(plan.limits).map(async ([metric, limit]) => ({
        metric,
        limit,
        used:
          metric === 'seats'
            ? await this.membershipsService.countForOrganization(organizationId)
            : await this.usageRepository.getCount(
                organizationId,
                metric,
                period,
              ),
      })),
    );
  }
}
