import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  SubscriptionInvoice,
  SubscriptionInvoiceDocument,
} from './schemas/subscription-invoice.schema';

@Injectable()
export class SubscriptionInvoicesRepository {
  constructor(
    @InjectModel(SubscriptionInvoice.name)
    private readonly model: Model<SubscriptionInvoiceDocument>,
  ) {}

  /**
   * Issues the invoice for one period, relying on the unique (subscriptionId, periodStart) index
   * to make double-billing impossible: a sweep that already issued this period's invoice and
   * then re-runs (BullMQ retry, a crash between issuing and renewing, two instances sweeping at
   * once) gets `null` back rather than a second invoice. `null` therefore means "already
   * issued", never "failed" — the caller treats it as success and proceeds to renew.
   */
  async issueForPeriod(
    data: Omit<SubscriptionInvoice, 'paidAt' | 'status'> &
      Partial<Pick<SubscriptionInvoice, 'paidAt' | 'status'>>,
  ): Promise<SubscriptionInvoiceDocument | null> {
    try {
      return await this.model.create(data);
    } catch (error) {
      if (isDuplicatePeriodError(error)) return null;
      throw error;
    }
  }

  /** The newest invoice for a subscription by the period it covers — what the scheduler checks
   *  to decide whether the previous period was ever paid. */
  findLatestForSubscription(
    subscriptionId: string,
  ): Promise<SubscriptionInvoiceDocument | null> {
    return this.model
      .findOne({ subscriptionId: new Types.ObjectId(subscriptionId) })
      .sort({ periodStart: -1 })
      .exec();
  }

  /** A tenant's own KORVA billing history, newest period first. */
  listForOrganization(
    organizationId: string,
    limit = 50,
  ): Promise<SubscriptionInvoiceDocument[]> {
    return this.model
      .find({ organizationId: new Types.ObjectId(organizationId) })
      .sort({ periodStart: -1 })
      .limit(limit)
      .exec();
  }

  /**
   * Marks one open invoice paid, guarded on `status: 'open'` so replaying this (a provider
   * webhook delivered twice, a manual reconciliation after an automatic one) is a no-op
   * returning null rather than overwriting the original paidAt — the same accept-or-reject
   * -by-filter pattern used by SubscriptionsRepository's own *IfEligible methods.
   */
  markPaidIfOpen(
    organizationId: string,
    id: string,
  ): Promise<SubscriptionInvoiceDocument | null> {
    return this.model
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
          status: 'open',
        },
        { status: 'paid', paidAt: new Date() },
        { new: true },
      )
      .exec();
  }
}

/**
 * True for the duplicate-key error raised by the unique (subscriptionId, periodStart) index —
 * narrowed by index field name, exactly like isDuplicateUserIdError (PasswordResetRepository)
 * and isDuplicateActionClaimError (WorkflowsRepository), so an unrelated unique-index collision
 * is never silently swallowed as "already issued".
 */
function isDuplicatePeriodError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as Record<string, unknown>;
  return (
    code === 11000 &&
    typeof message === 'string' &&
    message.includes('periodStart')
  );
}
