import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Supplier, SupplierDocument } from './schemas/supplier.schema';
import type { Paginated } from '../../crm/contacts/contacts.repository';

export interface FindSuppliersOptions {
  page: number;
  limit: number;
  search?: string;
}

@Injectable()
export class SuppliersRepository {
  constructor(
    @InjectModel(Supplier.name)
    private readonly supplierModel: Model<SupplierDocument>,
  ) {}

  create(data: Partial<Supplier>): Promise<SupplierDocument> {
    return this.supplierModel.create(data);
  }

  findById(
    organizationId: string,
    id: string,
  ): Promise<SupplierDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.supplierModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  async findAll(
    organizationId: string,
    options: FindSuppliersOptions,
  ): Promise<Paginated<SupplierDocument>> {
    const filter: FilterQuery<Supplier> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (options.search) {
      filter.name = { $regex: options.search, $options: 'i' };
    }

    const skip = (options.page - 1) * options.limit;
    const [data, total] = await Promise.all([
      this.supplierModel
        .find(filter)
        .sort({ name: 1 })
        .skip(skip)
        .limit(options.limit)
        .exec(),
      this.supplierModel.countDocuments(filter).exec(),
    ]);

    return { data, total };
  }

  update(
    organizationId: string,
    id: string,
    data: Partial<Supplier>,
  ): Promise<SupplierDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.supplierModel
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
    const res = await this.supplierModel
      .deleteOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
    return res.deletedCount > 0;
  }
}
