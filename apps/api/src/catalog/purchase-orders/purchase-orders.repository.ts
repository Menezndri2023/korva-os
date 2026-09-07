import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  PurchaseOrder,
  PurchaseOrderDocument,
} from './schemas/purchase-order.schema';
import type { PurchaseOrderStatus } from '@korva/types';
import type { Paginated } from '../../crm/contacts/contacts.repository';

export interface FindPurchaseOrdersOptions {
  page: number;
  limit: number;
  status?: PurchaseOrderStatus;
  supplierId?: string;
}

@Injectable()
export class PurchaseOrdersRepository {
  constructor(
    @InjectModel(PurchaseOrder.name)
    private readonly purchaseOrderModel: Model<PurchaseOrderDocument>,
  ) {}

  create(data: Partial<PurchaseOrder>): Promise<PurchaseOrderDocument> {
    return this.purchaseOrderModel.create(data);
  }

  findById(
    organizationId: string,
    id: string,
  ): Promise<PurchaseOrderDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.purchaseOrderModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  async findAll(
    organizationId: string,
    options: FindPurchaseOrdersOptions,
  ): Promise<Paginated<PurchaseOrderDocument>> {
    const filter: FilterQuery<PurchaseOrder> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (options.status) filter.status = options.status;
    if (options.supplierId && Types.ObjectId.isValid(options.supplierId)) {
      filter.supplierId = new Types.ObjectId(options.supplierId);
    }

    const skip = (options.page - 1) * options.limit;
    const [data, total] = await Promise.all([
      this.purchaseOrderModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(options.limit)
        .exec(),
      this.purchaseOrderModel.countDocuments(filter).exec(),
    ]);

    return { data, total };
  }

  /** Phase C4 (docs/KORVA_OS_V2_AUDIT.md §2.4) — per-supplier spend and on-time delivery off the
   *  existing PurchaseOrder ledger. `totalSpend` sums every line's quantity*unitCost across every
   *  PO (ordered value, not just received) — "how much has this supplier been committed for."
   *  On-time eligibility requires a RECEIVED PO with both `expectedDate` and `receivedAt` set —
   *  a PO with no expected date was never given a deadline to judge against. */
  aggregateSupplierAnalysis(organizationId: string): Promise<
    {
      _id: Types.ObjectId;
      purchaseOrderCount: number;
      totalSpend: number;
      onTimeEligible: number;
      onTimeCount: number;
    }[]
  > {
    return this.purchaseOrderModel.aggregate([
      { $match: { organizationId: new Types.ObjectId(organizationId) } },
      {
        $project: {
          supplierId: 1,
          lineTotal: {
            $sum: {
              $map: {
                input: '$items',
                as: 'item',
                in: { $multiply: ['$$item.quantity', '$$item.unitCost'] },
              },
            },
          },
          onTimeEligible: {
            $cond: [
              {
                $and: [
                  { $eq: ['$status', 'received'] },
                  { $ne: ['$expectedDate', null] },
                  { $ne: ['$receivedAt', null] },
                ],
              },
              1,
              0,
            ],
          },
          onTime: {
            $cond: [
              {
                $and: [
                  { $eq: ['$status', 'received'] },
                  { $ne: ['$expectedDate', null] },
                  { $ne: ['$receivedAt', null] },
                  { $lte: ['$receivedAt', '$expectedDate'] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
      {
        $group: {
          _id: '$supplierId',
          purchaseOrderCount: { $sum: 1 },
          totalSpend: { $sum: '$lineTotal' },
          onTimeEligible: { $sum: '$onTimeEligible' },
          onTimeCount: { $sum: '$onTime' },
        },
      },
    ]);
  }

  /** Used by SuppliersService's delete guard — a supplier with any non-cancelled PO can't be
   *  removed (its order history would dangle a broken reference). Cancelled POs don't block
   *  deletion: they're inert history, same "terminal states don't block" reasoning already used
   *  elsewhere in this codebase (e.g. a fully-refunded/cancelled Order never blocks anything). */
  hasActiveOrdersForSupplier(
    organizationId: string,
    supplierId: string,
  ): Promise<boolean> {
    return this.purchaseOrderModel
      .exists({
        organizationId: new Types.ObjectId(organizationId),
        supplierId: new Types.ObjectId(supplierId),
        status: { $ne: 'cancelled' },
      })
      .then((res) => res != null);
  }

  /** Guarded transition — only succeeds if the document is still in `from`, so two concurrent
   *  actions on the same PO (e.g. a double-click on "Réceptionner") can't both apply. */
  async transition(
    organizationId: string,
    id: string,
    from: PurchaseOrderStatus[],
    to: PurchaseOrderStatus,
    extra?: Partial<PurchaseOrder>,
  ): Promise<PurchaseOrderDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.purchaseOrderModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
          status: { $in: from },
        },
        { status: to, ...extra },
        { new: true },
      )
      .exec();
  }
}
