import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Plan, PlanDocument } from './schemas/plan.schema';

@Injectable()
export class PlansRepository {
  constructor(
    @InjectModel(Plan.name) private readonly planModel: Model<PlanDocument>,
  ) {}

  upsertByKeyAndCurrency(
    key: string,
    priceCurrency: string,
    data: Partial<Plan>,
  ): Promise<PlanDocument> {
    return this.planModel
      .findOneAndUpdate(
        { key, priceCurrency },
        { $setOnInsert: data },
        { upsert: true, new: true },
      )
      .exec();
  }

  /** Plans sellable in one currency, cheapest first. Never every plan in every currency: a
   *  tenant must not be shown a price they cannot be charged in. */
  findAllForCurrency(priceCurrency: string): Promise<PlanDocument[]> {
    return this.planModel
      .find({ priceCurrency })
      .sort({ priceAmount: 1 })
      .exec();
  }

  findByKeyAndCurrency(
    key: string,
    priceCurrency: string,
  ): Promise<PlanDocument | null> {
    return this.planModel.findOne({ key, priceCurrency }).exec();
  }

  findById(id: string): Promise<PlanDocument | null> {
    return this.planModel.findById(id).exec();
  }

  /** Genuinely new plan — distinct from upsertByKey, which is a seed-only "create if missing,
   *  never touch an existing one" helper ($setOnInsert) and cannot update anything. Used only
   *  by scripts/manage-plans.ts (see that script's own doc comment for why this is CLI-only,
   *  not an HTTP endpoint — no cross-tenant "platform operator" concept exists in this
   *  codebase's RBAC model, same reasoning as create-platform-integration-account.ts). */
  create(data: Partial<Plan>): Promise<PlanDocument> {
    return this.planModel.create(data);
  }

  /** `$set`, unlike upsertByKey's `$setOnInsert` — the one way to actually change an existing
   *  plan's price/modules/limits. Never upserts: updating a plan that doesn't exist is a
   *  script-usage error, not a create. */
  updateByKeyAndCurrency(
    key: string,
    priceCurrency: string,
    updates: Partial<Plan>,
  ): Promise<PlanDocument | null> {
    return this.planModel
      .findOneAndUpdate(
        { key, priceCurrency },
        { $set: updates },
        { new: true },
      )
      .exec();
  }
}
