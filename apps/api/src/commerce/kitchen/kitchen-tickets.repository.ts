import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  KitchenTicket,
  KitchenTicketDocument,
} from './schemas/kitchen-ticket.schema';

@Injectable()
export class KitchenTicketsRepository {
  constructor(
    @InjectModel(KitchenTicket.name)
    private readonly model: Model<KitchenTicketDocument>,
  ) {}

  /** Idempotent — a second open-tab call for the same order (shouldn't happen, but the unique
   *  index makes it safe either way) just returns the existing ticket rather than erroring. */
  async findOrCreateForOrder(
    organizationId: string,
    orderId: string,
    resourceId?: string,
  ): Promise<KitchenTicketDocument> {
    return this.model
      .findOneAndUpdate(
        {
          organizationId: new Types.ObjectId(organizationId),
          orderId: new Types.ObjectId(orderId),
        },
        {
          $setOnInsert: {
            organizationId: new Types.ObjectId(organizationId),
            orderId: new Types.ObjectId(orderId),
            resourceId: resourceId ? new Types.ObjectId(resourceId) : undefined,
            status: 'new',
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  findByOrderId(
    organizationId: string,
    orderId: string,
  ): Promise<KitchenTicketDocument | null> {
    return this.model
      .findOne({
        organizationId: new Types.ObjectId(organizationId),
        orderId: new Types.ObjectId(orderId),
      })
      .exec();
  }

  findById(
    organizationId: string,
    id: string,
  ): Promise<KitchenTicketDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.model
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  findAll(
    organizationId: string,
    status?: string,
  ): Promise<KitchenTicketDocument[]> {
    const filter: FilterQuery<KitchenTicket> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (status) filter.status = status;
    return this.model.find(filter).sort({ createdAt: 1 }).exec();
  }

  async updateStatus(
    organizationId: string,
    id: string,
    status: string,
  ): Promise<KitchenTicketDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.model
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
        },
        { status },
        { new: true },
      )
      .exec();
  }
}
