import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { Pagination } from '@korva/types';
import {
  WebhookDelivery,
  WebhookDeliveryDocument,
} from './schemas/webhook-delivery.schema';

@Injectable()
export class WebhookDeliveriesRepository {
  constructor(
    @InjectModel(WebhookDelivery.name)
    private readonly deliveryModel: Model<WebhookDeliveryDocument>,
  ) {}

  create(data: Partial<WebhookDelivery>): Promise<WebhookDeliveryDocument> {
    return this.deliveryModel.create(data);
  }

  findById(id: string): Promise<WebhookDeliveryDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.deliveryModel.findById(id).exec();
  }

  async update(id: string, data: Partial<WebhookDelivery>): Promise<void> {
    await this.deliveryModel.updateOne({ _id: id }, data).exec();
  }

  async findBySubscription(
    organizationId: string,
    subscriptionId: string,
    page: number,
    limit: number,
  ): Promise<{ data: WebhookDeliveryDocument[]; pagination: Pagination }> {
    const filter = {
      organizationId: new Types.ObjectId(organizationId),
      subscriptionId: new Types.ObjectId(subscriptionId),
    };
    const [data, total] = await Promise.all([
      this.deliveryModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.deliveryModel.countDocuments(filter).exec(),
    ]);
    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }
}
