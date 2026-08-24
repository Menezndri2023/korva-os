import { Injectable, NotFoundException } from '@nestjs/common';
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
