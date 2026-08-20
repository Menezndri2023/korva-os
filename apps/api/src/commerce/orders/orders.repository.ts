import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Order, OrderDocument } from './schemas/order.schema';
import type { Paginated } from '../../crm/contacts/contacts.repository';

export interface FindOrdersOptions {
  page: number;
  limit: number;
  status?: string;
  contactId?: string;
}

@Injectable()
export class OrdersRepository {
  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
  ) {}

  create(data: Partial<Order>): Promise<OrderDocument> {
    return this.orderModel.create(data);
  }

  findById(organizationId: string, id: string): Promise<OrderDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.orderModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  findByBookingId(
    organizationId: string,
    bookingId: string,
  ): Promise<OrderDocument | null> {
    return this.orderModel
      .findOne({
        organizationId: new Types.ObjectId(organizationId),
        bookingId: new Types.ObjectId(bookingId),
      })
      .exec();
  }

  async findAll(
    organizationId: string,
    options: FindOrdersOptions,
  ): Promise<Paginated<OrderDocument>> {
    const filter: FilterQuery<Order> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (options.status) filter.status = options.status;
    if (options.contactId)
      filter.contactId = new Types.ObjectId(options.contactId);

    const skip = (options.page - 1) * options.limit;
    const [data, total] = await Promise.all([
      this.orderModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(options.limit)
        .exec(),
      this.orderModel.countDocuments(filter).exec(),
    ]);

    return { data, total };
  }

  async update(
    organizationId: string,
    id: string,
    data: Partial<Order>,
  ): Promise<OrderDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.orderModel
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
