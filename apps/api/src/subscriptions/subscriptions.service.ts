import { Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PlansService } from './plans.service';
import { SubscriptionsRepository } from './subscriptions.repository';
import { SubscriptionDocument } from './schemas/subscription.schema';
import { PlanDocument } from './schemas/plan.schema';
import { AuditService } from '../audit/audit.service';

function addOneMonth(date: Date): Date {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + 1);
  return result;
}

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly plansService: PlansService,
    private readonly auditService: AuditService,
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
    const now = new Date();
    const updated = await this.subscriptionsRepository.update(organizationId, {
      planId: plan._id,
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: addOneMonth(now),
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
      metadata: { plan: planKey },
    });

    return updated;
  }
}
