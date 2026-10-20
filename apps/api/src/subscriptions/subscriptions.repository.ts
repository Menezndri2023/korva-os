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
  /** Signup trials whose end has passed and whose modules have not been settled yet. */
  findExpiredUnsettledTrials(
    now: Date,
    limit = 100,
  ): Promise<SubscriptionDocument[]> {
    return this.subscriptionModel
      .find({ trialEndsAt: { $lte: now }, trialSettledAt: null })
      .limit(limit)
      .exec();
  }

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
  /**
   * Clears a stored proration once it has been folded into a SubscriptionInvoice, so it is
   * billed exactly once. Called AFTER the invoice is issued, never before: if the issuance
   * fails, the proration must still be there for the next sweep to apply.
   *
   * Guarded on the exact `prorationAmount` that was applied, not just on the subscription id —
   * a changePlan() landing between the issuance and this write stores a NEW proration, and
   * clearing blindly would discard it unbilled.
   */
  clearAppliedProration(
    organizationId: string,
    id: string,
    appliedAmount: number,
  ): Promise<SubscriptionDocument | null> {
    return this.subscriptionModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
          prorationAmount: appliedAmount,
        },
        {
          prorationAmount: null,
          prorationCurrency: null,
          prorationCalculatedAt: null,
        },
        { new: true },
      )
      .exec();
  }

  /**
   * Returns a 'past_due' subscription to 'active' once its overdue SubscriptionInvoice is paid.
   *
   * Deliberately does NOT touch the billing period. The paid invoice covers the period that
   * already elapsed while the subscription sat past_due, so leaving currentPeriodEnd in the past
   * makes the subscription an immediate renewal candidate again — and the very next sweep, now
   * seeing that latest invoice as 'paid', issues the next period's invoice and advances
   * normally. Rewriting the period here would duplicate that logic and risk disagreeing with it.
   *
   * Guarded on status:'past_due', so paying an invoice for an already-active or canceled
   * subscription is a no-op (returns null) rather than resurrecting it.
   */
  reactivateFromPastDue(
    organizationId: string,
  ): Promise<SubscriptionDocument | null> {
    return this.subscriptionModel
      .findOneAndUpdate(
        {
          organizationId: new Types.ObjectId(organizationId),
          status: 'past_due',
        },
        { status: 'active' },
        { new: true },
      )
      .exec();
  }

  /**
   * Atomically moves a single subscription to 'past_due', guarded by the SAME eligibility filter
   * used by findRenewalCandidates plus cancelAtPeriodEnd:false — so a subscription canceled
   * concurrently between the sweep's read and this write is left untouched, and re-running this
   * on an already-past_due subscription is a no-op (returns null).
   *
   * Deliberately leaves currentPeriodStart/currentPeriodEnd alone: the period genuinely did NOT
   * advance, because it was not paid for. The subscription therefore stays a renewal candidate
   * (status is filtered to 'active' by findRenewalCandidates, so it drops out of the sweep until
   * something reactivates it) — reaching past_due is a terminal step for the sweep, not a state
   * it keeps re-deciding every tick.
   */
  markPastDueIfEligible(
    organizationId: string,
    id: string,
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
        { status: 'past_due' },
        { new: true },
      )
      .exec();
  }

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
