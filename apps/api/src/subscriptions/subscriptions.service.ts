import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PlansService } from './plans.service';
import { SubscriptionsRepository } from './subscriptions.repository';
import { SubscriptionDocument } from './schemas/subscription.schema';
import { PlanDocument } from './schemas/plan.schema';
import { AuditService } from '../audit/audit.service';
import {
  Organization,
  OrganizationDocument,
} from '../organizations/schemas/organization.schema';

function addOneMonth(date: Date): Date {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + 1);
  return result;
}

/**
 * Fair-share proration for a mid-period plan change: the fraction of the CURRENT period still
 * remaining, multiplied by the price delta between the old and new plan. Positive means the new
 * plan is more expensive for the time left (amount owed), negative means a credit. Returns null
 * when there is nothing sensible to compute (no prior period, or the two plans don't share a
 * currency) — the caller stores null in that case rather than a misleading 0.
 */
function computeProration(
  oldPriceAmount: number,
  oldPriceCurrency: string,
  newPriceAmount: number,
  newPriceCurrency: string,
  currentPeriodStart: Date,
  currentPeriodEnd: Date,
  now: Date,
): number | null {
  if (oldPriceCurrency !== newPriceCurrency) return null;
  const totalMs = currentPeriodEnd.getTime() - currentPeriodStart.getTime();
  if (totalMs <= 0) return null;
  const remainingMs = Math.min(
    totalMs,
    Math.max(0, currentPeriodEnd.getTime() - now.getTime()),
  );
  const remainingFraction = remainingMs / totalMs;
  const delta = newPriceAmount - oldPriceAmount;
  return Math.round(delta * remainingFraction * 100) / 100;
}

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly plansService: PlansService,
    private readonly auditService: AuditService,
    // Registered directly here (not via OrganizationsModule/OrganizationsRepository) to avoid
    // a circular module dependency — OrganizationsModule already imports SubscriptionsModule.
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<OrganizationDocument>,
  ) {}

  /** Called once, from OrganizationsService.createForOwner — every organization starts on "free". */
  async createDefaultSubscription(
    organizationId: string,
  ): Promise<SubscriptionDocument> {
    const plan = await this.plansService.getByKey('free');
    const now = new Date();
    return this.subscriptionsRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      planId: plan._id,
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: addOneMonth(now),
    });
  }

  async getForOrganization(
    organizationId: string,
  ): Promise<SubscriptionDocument> {
    const subscription =
      await this.subscriptionsRepository.findForOrganization(organizationId);
    if (!subscription) {
      throw new NotFoundException({
        code: 'SUBSCRIPTION_NOT_FOUND',
        message: 'No subscription found for this organization',
      });
    }
    return subscription;
  }

  async getActivePlan(organizationId: string): Promise<PlanDocument> {
    const subscription = await this.getForOrganization(organizationId);
    return this.plansService.getById(subscription.planId.toString());
  }

  async changePlan(
    organizationId: string,
    userId: string,
    planKey: string,
  ): Promise<SubscriptionDocument> {
    const plan = await this.plansService.getByKey(planKey);

    // A downgrade must never leave enabledModules claiming access to a module the new plan no
    // longer includes — drop exactly those, keep everything the new plan still allows. Never
    // add modules the organization hadn't already chosen to enable, even if the new plan
    // permits more than the old one.
    const organization = await this.organizationModel
      .findById(organizationId)
      .exec();
    if (organization) {
      const stillAllowed = organization.enabledModules.filter((module) =>
        plan.modules.includes(module),
      );
      if (stillAllowed.length !== organization.enabledModules.length) {
        organization.enabledModules = stillAllowed;
        await organization.save();
      }
    }

    const existing =
      await this.subscriptionsRepository.findForOrganization(organizationId);

    // Only worth computing against a genuinely still-running prior period — a subscription
    // already past its period end is about to be handled by the period scheduler anyway, and
    // proration against a period that's already over is meaningless.
    let prorationAmount: number | null = null;
    let prorationCurrency: string | null = null;
    const now = new Date();
    if (existing && existing.currentPeriodEnd.getTime() > now.getTime()) {
      const oldPlan = await this.plansService.getById(
        existing.planId.toString(),
      );
      prorationAmount = computeProration(
        oldPlan.priceAmount,
        oldPlan.priceCurrency,
        plan.priceAmount,
        plan.priceCurrency,
        existing.currentPeriodStart,
        existing.currentPeriodEnd,
        now,
      );
      prorationCurrency = prorationAmount !== null ? plan.priceCurrency : null;
    }

    const updated = await this.subscriptionsRepository.update(organizationId, {
      planId: plan._id,
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: addOneMonth(now),
      // Choosing a new plan is an active intent to keep the subscription — any pending
      // cancel-at-period-end request no longer applies to the (freshly extended) period.
      cancelAtPeriodEnd: false,
      cancelRequestedAt: null,
      prorationAmount,
      prorationCurrency,
      prorationCalculatedAt: prorationAmount !== null ? now : null,
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'SUBSCRIPTION_NOT_FOUND',
        message: 'No subscription found for this organization',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'SETTINGS_CHANGE',
      entity: 'subscription',
      entityId: updated.id as string,
      metadata: { plan: planKey, prorationAmount, prorationCurrency },
    });

    return updated;
  }

  /**
   * `immediate: true` revokes access now — status becomes 'canceled' right away.
   * `immediate: false` (default) is the standard SaaS UX: the subscription stays 'active' and
   * usable until currentPeriodEnd, only flagging cancelAtPeriodEnd — SubscriptionPeriodScheduler
   * performs the actual terminal transition once that date passes. See reactivate() for undoing
   * this while still within the grace window.
   */
  async cancel(
    organizationId: string,
    userId: string,
    immediate: boolean,
  ): Promise<SubscriptionDocument> {
    // Surfaces a clean 404 (no subscription at all) distinctly from the 409s below.
    await this.getForOrganization(organizationId);

    const updated = immediate
      ? await this.subscriptionsRepository.cancelNow(organizationId)
      : await this.subscriptionsRepository.requestCancelAtPeriodEnd(
          organizationId,
        );

    if (!updated) {
      throw new ConflictException({
        code: 'SUBSCRIPTION_CANCEL_CONFLICT',
        message: immediate
          ? 'This subscription is already canceled'
          : 'This subscription is already canceled or already scheduled to cancel at period end',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'SETTINGS_CHANGE',
      entity: 'subscription',
      entityId: updated.id as string,
      metadata: { cancel: immediate ? 'immediate' : 'at_period_end' },
    });

    return updated;
  }

  /**
   * Undoes a pending cancel-at-period-end request while still within the grace window (status
   * still 'active' and currentPeriodEnd still in the future — see
   * SubscriptionsRepository.reactivateIfEligible). Fails on an immediately-canceled subscription
   * (there is no grace window for that) and on one whose period has already elapsed, even if the
   * scheduler hasn't ticked yet to formally flip it to 'canceled'.
   */
  async reactivate(
    organizationId: string,
    userId: string,
  ): Promise<SubscriptionDocument> {
    await this.getForOrganization(organizationId);

    const updated =
      await this.subscriptionsRepository.reactivateIfEligible(organizationId);
    if (!updated) {
      throw new ConflictException({
        code: 'SUBSCRIPTION_REACTIVATE_NOT_ELIGIBLE',
        message:
          'This subscription cannot be reactivated — it is not pending cancellation within its grace window',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'SETTINGS_CHANGE',
      entity: 'subscription',
      entityId: updated.id as string,
      metadata: { reactivated: true },
    });

    return updated;
  }
}
