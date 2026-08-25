import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Subscription,
  SubscriptionDocument,
} from './schemas/subscription.schema';

@Injectable()
export class SubscriptionsRepository {
  constructor(
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<SubscriptionDocument>,
  ) {}

  create(data: Partial<Subscription>): Promise<SubscriptionDocument> {
    return this.subscriptionModel.create(data);
  }

  findForOrganization(
    organizationId: string,
  ): Promise<SubscriptionDocument | null> {
    return this.subscriptionModel
      .findOne({ organizationId: new Types.ObjectId(organizationId) })
      .exec();
  }

  update(
    organizationId: string,
    data: Partial<Subscription>,
  ): Promise<SubscriptionDocument | null> {
    return this.subscriptionModel
      .findOneAndUpdate(
        { organizationId: new Types.ObjectId(organizationId) },
        data,
        { new: true },
      )
      .exec();
  }

  /**
   * Cancels immediately, guarded so it only ever fires from a non-terminal state — re-running
   * this on an already-canceled subscription (a retry, or a second concurrent request) is a
   * no-op (returns null) rather than clobbering canceledAt/cancelRequestedAt a second time.
   */
  cancelNow(organizationId: string): Promise<SubscriptionDocument | null> {
    const now = new Date();
    return this.subscriptionModel
      .findOneAndUpdate(
        {
          organizationId: new Types.ObjectId(organizationId),
          status: { $ne: 'canceled' },
        },
        {
          status: 'canceled',
          cancelAtPeriodEnd: false,
          cancelRequestedAt: now,
          canceledAt: now,
        },
        { new: true },
      )
      .exec();
  }

  /**
   * Flags cancelAtPeriodEnd — the subscription stays 'active' and usable until currentPeriodEnd;
   * the actual terminal transition happens later, via SubscriptionPeriodSchedulerService.
   * Guarded to only fire from 'active' with cancelAtPeriodEnd not already true, so a duplicate
   * request is a no-op (returns null) instead of resetting cancelRequestedAt to "now" again.
   */
  requestCancelAtPeriodEnd(
    organizationId: string,
  ): Promise<SubscriptionDocument | null> {
    return this.subscriptionModel
      .findOneAndUpdate(
        {
          organizationId: new Types.ObjectId(organizationId),
          status: 'active',
          cancelAtPeriodEnd: false,
        },
        { cancelAtPeriodEnd: true, cancelRequestedAt: new Date() },
        { new: true },
      )
      .exec();
  }

  /**
   * Undoes a pending cancel-at-period-end request, guarded so it only succeeds while still
   * within the grace window: status must still be 'active' (not yet flipped to 'canceled' by the
   * scheduler) AND currentPeriodEnd must still be in the future — the second condition makes
   * this deterministic even if the scheduler hasn't ticked yet on an already-past-due
   * cancellation, rather than depending on scheduler timing. Returns null (caller surfaces a
   * conflict) if there is nothing eligible to reactivate.
   */
  reactivateIfEligible(
    organizationId: string,
  ): Promise<SubscriptionDocument | null> {
    return this.subscriptionModel
      .findOneAndUpdate(
        {
          organizationId: new Types.ObjectId(organizationId),
          status: 'active',
          cancelAtPeriodEnd: true,
          currentPeriodEnd: { $gt: new Date() },
        },
        { cancelAtPeriodEnd: false, cancelRequestedAt: null },
        { new: true },
      )
      .exec();
  }

  /**
   * Candidate list for SubscriptionPeriodSchedulerService — mirrors QuotesRepository.
   * findExpirable / InvoicesRepository.findOverdueCandidates (a global, org-agnostic query; the
   * sweep is system-wide, not per-tenant). Covers both branches the scheduler handles: a
   * cancelAtPeriodEnd candidate (transitions to 'canceled') and a non-canceling one (renews).
   */
  findRenewalCandidates(limit = 100): Promise<SubscriptionDocument[]> {
    return this.subscriptionModel
      .find({ status: 'active', currentPeriodEnd: { $lt: new Date() } })
      .limit(limit)
      .exec();
  }

  /**
   * Atomically transitions a single subscription to 'canceled', guarded by the SAME eligibility
   * filter used by findRenewalCandidates plus cancelAtPeriodEnd:true — so a subscription
   * reactivated concurrently between the sweep's read and this write is left untouched, and
   * re-running this on an already-canceled subscription is a no-op (returns null).
   */
  cancelIfEligible(
    organizationId: string,
    id: string,
  ): Promise<SubscriptionDocument | null> {
    return this.subscriptionModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
          status: 'active',
          cancelAtPeriodEnd: true,
          currentPeriodEnd: { $lt: new Date() },
        },
        { status: 'canceled', canceledAt: new Date() },
        { new: true },
      )
      .exec();
  }

  /**
   * Atomically advances a single subscription's billing period, guarded by the SAME eligibility
   * filter used by findRenewalCandidates plus cancelAtPeriodEnd:false — so a subscription whose
   * cancellation was requested concurrently between the sweep's read and this write is left
   * untouched (the cancel branch picks it up on its own next tick), and re-running this on an
   * already-renewed subscription (currentPeriodEnd now in the future) is a no-op (returns null).
   */
  renewIfEligible(
    organizationId: string,
    id: string,
    currentPeriodStart: Date,
    currentPeriodEnd: Date,
  ): Promise<SubscriptionDocument | null> {
    return this.subscriptionModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
          status: 'active',
          cancelAtPeriodEnd: false,
          currentPeriodEnd: { $lt: new Date() },
        },
        { currentPeriodStart, currentPeriodEnd },
        { new: true },
      )
      .exec();
  }
}
