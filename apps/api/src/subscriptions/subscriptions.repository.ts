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
}
