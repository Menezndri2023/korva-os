import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  ReturnRequest,
  ReturnRequestDocument,
} from './schemas/return-request.schema';
import type { Paginated } from '../../crm/contacts/contacts.repository';

export interface FindReturnRequestsOptions {
  page: number;
  limit: number;
  status?: string;
  orderId?: string;
  contactId?: string;
}

@Injectable()
export class ReturnRequestsRepository {
  constructor(
    @InjectModel(ReturnRequest.name)
    private readonly model: Model<ReturnRequestDocument>,
  ) {}

  create(data: Partial<ReturnRequest>): Promise<ReturnRequestDocument> {
    return this.model.create(data);
  }

  findById(
    organizationId: string,
    id: string,
  ): Promise<ReturnRequestDocument | null> {
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
    options: FindReturnRequestsOptions,
  ): Promise<Paginated<ReturnRequestDocument>> {
    const filter: FilterQuery<ReturnRequest> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (options.status) filter.status = options.status;
    if (options.orderId) filter.orderId = new Types.ObjectId(options.orderId);
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

  /** Every APPROVED return request against one order — used to compute how much of each line
   *  item has already been returned, so a second return request can't re-claim quantity a first
   *  one already refunded. Pending/rejected requests don't reserve anything. */
  findApprovedByOrderId(
    organizationId: string,
    orderId: string,
  ): Promise<ReturnRequestDocument[]> {
    return this.model
      .find({
        organizationId: new Types.ObjectId(organizationId),
        orderId: new Types.ObjectId(orderId),
        status: 'approved',
      })
      .exec();
  }

  /** Atomic pending -> approved transition, guarding against a double-approval race the same
   *  way RecurringBillingRepository.cancel guards status:'active'. */
  async markApproved(
    organizationId: string,
    id: string,
    reviewedByUserId: string,
  ): Promise<ReturnRequestDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.model
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
          status: 'pending',
        },
        {
          status: 'approved',
          reviewedByUserId: new Types.ObjectId(reviewedByUserId),
          reviewedAt: new Date(),
        },
        { new: true },
      )
      .exec();
  }

  /** Rolls a request back to 'pending' if refunding it failed after the approval transition —
   *  see ReturnRequestsService.approve's own doc comment for why this must be possible. */
  revertToPending(
    organizationId: string,
    id: string,
  ): Promise<ReturnRequestDocument | null> {
    return this.model
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
        },
        {
          status: 'pending',
          $unset: { reviewedByUserId: 1, reviewedAt: 1 },
        },
        { new: true },
      )
      .exec();
  }

  setRefundId(
    organizationId: string,
    id: string,
    refundId: string,
  ): Promise<ReturnRequestDocument | null> {
    return this.model
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
        },
        { refundId: new Types.ObjectId(refundId) },
        { new: true },
      )
      .exec();
  }

  async reject(
    organizationId: string,
    id: string,
    reviewedByUserId: string,
    rejectionReason: string | undefined,
  ): Promise<ReturnRequestDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.model
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
          status: 'pending',
        },
        {
          status: 'rejected',
          rejectionReason,
          reviewedByUserId: new Types.ObjectId(reviewedByUserId),
          reviewedAt: new Date(),
        },
        { new: true },
      )
      .exec();
  }
}
