import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Usage, UsageDocument } from './schemas/usage.schema';

@Injectable()
export class UsageRepository {
  constructor(
    @InjectModel(Usage.name) private readonly usageModel: Model<UsageDocument>,
  ) {}

  async getCount(
    organizationId: string,
    metric: string,
    period: string,
  ): Promise<number> {
    const usage = await this.usageModel
      .findOne({
        organizationId: new Types.ObjectId(organizationId),
        metric,
        period,
      })
      .exec();
    return usage?.count ?? 0;
  }

  async increment(
    organizationId: string,
    metric: string,
    period: string,
    amount = 1,
  ): Promise<number> {
    const usage = await this.usageModel
      .findOneAndUpdate(
        { organizationId: new Types.ObjectId(organizationId), metric, period },
        { $inc: { count: amount } },
        { upsert: true, new: true },
      )
      .exec();
    return usage.count;
  }
}
