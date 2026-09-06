import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Warehouse, WarehouseDocument } from './schemas/warehouse.schema';

@Injectable()
export class WarehousesRepository {
  constructor(
    @InjectModel(Warehouse.name)
    private readonly warehouseModel: Model<WarehouseDocument>,
  ) {}

  create(data: Partial<Warehouse>): Promise<WarehouseDocument> {
    return this.warehouseModel.create(data);
  }

  findById(
    organizationId: string,
    id: string,
  ): Promise<WarehouseDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.warehouseModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  findAllForOrganization(organizationId: string): Promise<WarehouseDocument[]> {
    return this.warehouseModel
      .find({ organizationId: new Types.ObjectId(organizationId) })
      .sort({ name: 1 })
      .exec();
  }

  countForOrganization(organizationId: string): Promise<number> {
    return this.warehouseModel
      .countDocuments({ organizationId: new Types.ObjectId(organizationId) })
      .exec();
  }

  /** Same pattern as crm/pipelines' own isDefault handling — at most one default at a time. */
  async unsetDefaultForOthers(
    organizationId: string,
    exceptId?: string,
  ): Promise<void> {
    const filter: Record<string, unknown> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (exceptId) filter._id = { $ne: new Types.ObjectId(exceptId) };
    await this.warehouseModel.updateMany(filter, { isDefault: false }).exec();
  }

  update(
    organizationId: string,
    id: string,
    data: Partial<Warehouse>,
  ): Promise<WarehouseDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.warehouseModel
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

  async delete(organizationId: string, id: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    const res = await this.warehouseModel
      .deleteOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
    return res.deletedCount > 0;
  }
}
