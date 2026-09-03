import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  StockMovement,
  StockMovementDocument,
} from './schemas/stock-movement.schema';
import type { Paginated } from '../../crm/contacts/contacts.repository';

export interface FindStockMovementsOptions {
  page: number;
  limit: number;
  variantId?: string;
}

@Injectable()
export class StockMovementsRepository {
  constructor(
    @InjectModel(StockMovement.name)
    private readonly stockMovementModel: Model<StockMovementDocument>,
  ) {}

  create(data: Partial<StockMovement>): Promise<StockMovementDocument> {
    return this.stockMovementModel.create(data);
  }

  async findAll(
    organizationId: string,
    offerId: string,
    options: FindStockMovementsOptions,
  ): Promise<Paginated<StockMovementDocument>> {
    const filter: FilterQuery<StockMovement> = {
      organizationId: new Types.ObjectId(organizationId),
      offerId: new Types.ObjectId(offerId),
    };
    if (options.variantId) {
      filter.variantId = new Types.ObjectId(options.variantId);
    }

    const skip = (options.page - 1) * options.limit;
    const [data, total] = await Promise.all([
      this.stockMovementModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(options.limit)
        .exec(),
      this.stockMovementModel.countDocuments(filter).exec(),
    ]);

    return { data, total };
  }
}
