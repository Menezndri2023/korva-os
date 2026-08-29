import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  WebhookSubscription,
  WebhookSubscriptionDocument,
} from './schemas/webhook-subscription.schema';

@Injectable()
export class WebhookSubscriptionsRepository {
  constructor(
    @InjectModel(WebhookSubscription.name)
    private readonly subscriptionModel: Model<WebhookSubscriptionDocument>,
  ) {}

  create(
    data: Partial<WebhookSubscription>,
  ): Promise<WebhookSubscriptionDocument> {
    return this.subscriptionModel.create(data);
  }

  findByOrganization(
    organizationId: string,
  ): Promise<WebhookSubscriptionDocument[]> {
    return this.subscriptionModel
      .find({ organizationId: new Types.ObjectId(organizationId) })
      .sort({ createdAt: -1 })
      .exec();
  }

  findByIdForOrganization(
    id: string,
    organizationId: string,
  ): Promise<WebhookSubscriptionDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.subscriptionModel
      .findOne({ _id: id, organizationId: new Types.ObjectId(organizationId) })
      .exec();
  }

  /** `secretEncrypted` is `select: false` on the schema — callers that actually need to sign a
   *  delivery (WebhookDeliveryWorker) must ask for it explicitly via this method. */
  findByIdWithSecret(id: string): Promise<WebhookSubscriptionDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.subscriptionModel
      .findById(id)
      .select('+secretEncrypted')
      .exec();
  }

  /** Used by WebhookDispatchService on every event — only active subscriptions whose `events`
   *  list includes this one are ever enqueued for delivery. */
  findActiveForEvent(
    organizationId: string,
    eventName: string,
  ): Promise<WebhookSubscriptionDocument[]> {
    return this.subscriptionModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
        active: true,
        events: eventName,
      })
      .exec();
  }

  async update(
    organizationId: string,
    id: string,
    data: Partial<WebhookSubscription>,
  ): Promise<WebhookSubscriptionDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.subscriptionModel
      .findOneAndUpdate(
        { _id: id, organizationId: new Types.ObjectId(organizationId) },
        data,
        { new: true },
      )
      .exec();
  }

  async delete(organizationId: string, id: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    const result = await this.subscriptionModel
      .deleteOne({
        _id: id,
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
    return result.deletedCount > 0;
  }

  async recordDeliveryOutcome(
    id: string,
    status: 'success' | 'failed',
  ): Promise<void> {
    await this.subscriptionModel
      .updateOne(
        { _id: id },
        { lastDeliveryAt: new Date(), lastDeliveryStatus: status },
      )
      .exec();
  }
}
