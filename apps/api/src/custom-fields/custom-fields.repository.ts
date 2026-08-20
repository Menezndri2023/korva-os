import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { CustomFieldEntity } from '@korva/types';
import {
  CustomField,
  CustomFieldDocument,
} from './schemas/custom-field.schema';

@Injectable()
export class CustomFieldsRepository {
  constructor(
    @InjectModel(CustomField.name)
    private readonly customFieldModel: Model<CustomFieldDocument>,
  ) {}

  create(data: Partial<CustomField>): Promise<CustomFieldDocument> {
    return this.customFieldModel.create(data);
  }

  findByOrganizationAndEntity(
    organizationId: string,
    entity: CustomFieldEntity,
  ): Promise<CustomFieldDocument[]> {
    return this.customFieldModel
      .find({ organizationId: new Types.ObjectId(organizationId), entity })
      .exec();
  }

  findById(
    organizationId: string,
    id: string,
  ): Promise<CustomFieldDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.customFieldModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  async update(
    organizationId: string,
    id: string,
    data: Partial<CustomField>,
  ): Promise<CustomFieldDocument | null> {
    return this.customFieldModel
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
    const res = await this.customFieldModel
      .deleteOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
    return res.deletedCount > 0;
  }
}
