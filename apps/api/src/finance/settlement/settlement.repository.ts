import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Settlement, SettlementDocument } from './schemas/settlement.schema';

@Injectable()
export class SettlementRepository {
  constructor(
    @InjectModel(Settlement.name)
    private readonly settlementModel: Model<SettlementDocument>,
  ) {}

  async create(data: Partial<Settlement>): Promise<SettlementDocument> {
    const [settlement] = await this.settlementModel.create([data]);
    return settlement!;
  }

  findById(
    organizationId: string,
    id: string,
  ): Promise<SettlementDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.settlementModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  /** Tenant-scoped listing — never returns another organization's settlements. */
  findAll(organizationId: string): Promise<SettlementDocument[]> {
    return this.settlementModel
      .find({ organizationId: new Types.ObjectId(organizationId) })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * organizationId-scoped update — the filter itself is what enforces tenant isolation: a
   * settlement id that exists but belongs to a different organization simply doesn't match,
   * and this resolves to null exactly as if the id didn't exist at all (never leaks whether the
   * id belongs to someone else).
   */
  markSettled(
    organizationId: string,
    id: string,
    settledAt: Date,
  ): Promise<SettlementDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.settlementModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
        },
        { status: 'settled', settledAt },
        { new: true },
      )
      .exec();
  }
}
