import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  RecurringBilling,
  RecurringBillingDocument,
} from './schemas/recurring-billing.schema';
import type { Paginated } from '../../crm/contacts/contacts.repository';

export interface FindRecurringBillingsOptions {
  page: number;
  limit: number;
  status?: string;
  contactId?: string;
}

@Injectable()
export class RecurringBillingRepository {
  constructor(
    @InjectModel(RecurringBilling.name)
    private readonly model: Model<RecurringBillingDocument>,
  ) {}

  create(data: Partial<RecurringBilling>): Promise<RecurringBillingDocument> {
    return this.model.create(data);
  }

  findById(
    organizationId: string,
    id: string,
  ): Promise<RecurringBillingDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.model
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  async findAll(
    organizationId: string,
    options: FindRecurringBillingsOptions,
  ): Promise<Paginated<RecurringBillingDocument>> {
    const filter: FilterQuery<RecurringBilling> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (options.status) filter.status = options.status;
    if (options.contactId) {
      filter.contactId = new Types.ObjectId(options.contactId);
    }

    const skip = (options.page - 1) * options.limit;
    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(options.limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { data, total };
  }

  /** Global (org-agnostic) sweep, same pattern as QuotesRepository.findExpirable. */
  findDue(now: Date): Promise<RecurringBillingDocument[]> {
    return this.model
      .find({ status: 'active', nextBillingDate: { $lte: now } })
      .exec();
  }

  async cancel(
    organizationId: string,
    id: string,
  ): Promise<RecurringBillingDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.model
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
          status: 'active',
        },
        { status: 'cancelled', cancelledAt: new Date() },
        { new: true },
      )
      .exec();
  }

  /**
   * Atomically advances `nextBillingDate` and stamps the just-created invoice — the same
   * `status:'active'` guard in the filter as `cancel()` means a plan cancelled by the owner
   * between the sweep's initial `findDue()` read and this write is simply skipped (no charge
   * recorded against a plan the customer already cancelled), never overwritten back to active.
   */
  async recordCharge(
    id: string,
    nextBillingDate: Date,
    invoiceId: string,
  ): Promise<RecurringBillingDocument | null> {
    return this.model
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), status: 'active' },
        { nextBillingDate, lastInvoiceId: new Types.ObjectId(invoiceId) },
        { new: true },
      )
      .exec();
  }
}
