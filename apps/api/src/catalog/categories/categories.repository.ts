import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Category, CategoryDocument } from './schemas/category.schema';

@Injectable()
export class CategoriesRepository {
  constructor(
    @InjectModel(Category.name)
    private readonly categoryModel: Model<CategoryDocument>,
  ) {}

  create(data: Partial<Category>): Promise<CategoryDocument> {
    return this.categoryModel.create(data);
  }

  findById(
    organizationId: string,
    id: string,
  ): Promise<CategoryDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.categoryModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  findByName(
    organizationId: string,
    name: string,
  ): Promise<CategoryDocument | null> {
    return this.categoryModel
      .findOne({ organizationId: new Types.ObjectId(organizationId), name })
      .exec();
  }

  findAllForOrganization(organizationId: string): Promise<CategoryDocument[]> {
    return this.categoryModel
      .find({ organizationId: new Types.ObjectId(organizationId) })
      .sort({ name: 1 })
      .exec();
  }

  async update(
    organizationId: string,
    id: string,
    data: Partial<Category>,
  ): Promise<CategoryDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.categoryModel
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
    const res = await this.categoryModel
      .deleteOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
    return res.deletedCount > 0;
  }
}
