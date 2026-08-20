import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Fulfillment, FulfillmentDocument } from './schemas/fulfillment.schema';

@Injectable()
export class FulfillmentsRepository {
  constructor(
    @InjectModel(Fulfillment.name)
    private readonly fulfillmentModel: Model<FulfillmentDocument>,
  ) {}

  create(data: Partial<Fulfillment>): Promise<FulfillmentDocument> {
    return this.fulfillmentModel.create(data);
  }

  findByOrderId(
    organizationId: string,
    orderId: string,
  ): Promise<FulfillmentDocument | null> {
    return this.fulfillmentModel
      .findOne({
        organizationId: new Types.ObjectId(organizationId),
        orderId: new Types.ObjectId(orderId),
      })
      .exec();
  }

  findById(
    organizationId: string,
    id: string,
  ): Promise<FulfillmentDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.fulfillmentModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  async update(
    organizationId: string,
    id: string,
    data: Partial<Fulfillment>,
  ): Promise<FulfillmentDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.fulfillmentModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
        },
        data,
        { new: true },
      )
      .exec();
  }
}
