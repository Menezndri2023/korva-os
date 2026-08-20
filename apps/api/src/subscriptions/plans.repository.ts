import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Plan, PlanDocument } from './schemas/plan.schema';

@Injectable()
export class PlansRepository {
  constructor(
    @InjectModel(Plan.name) private readonly planModel: Model<PlanDocument>,
  ) {}

  upsertByKey(key: string, data: Partial<Plan>): Promise<PlanDocument> {
    return this.planModel
      .findOneAndUpdate(
        { key },
        { $setOnInsert: data },
        { upsert: true, new: true },
      )
      .exec();
  }

  findAll(): Promise<PlanDocument[]> {
    return this.planModel.find().sort({ priceAmount: 1 }).exec();
  }

  findByKey(key: string): Promise<PlanDocument | null> {
    return this.planModel.findOne({ key }).exec();
  }

  findById(id: string): Promise<PlanDocument | null> {
    return this.planModel.findById(id).exec();
  }
}
