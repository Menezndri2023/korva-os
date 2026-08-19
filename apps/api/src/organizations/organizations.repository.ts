import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Organization,
  OrganizationDocument,
} from './schemas/organization.schema';

@Injectable()
export class OrganizationsRepository {
  constructor(
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<OrganizationDocument>,
  ) {}

  create(data: Partial<Organization>): Promise<OrganizationDocument> {
    return this.organizationModel.create(data);
  }

  findById(id: string): Promise<OrganizationDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.organizationModel.findById(id).exec();
  }

  findBySlug(slug: string): Promise<OrganizationDocument | null> {
    return this.organizationModel.findOne({ slug }).exec();
  }

  findByIds(ids: string[]): Promise<OrganizationDocument[]> {
    const objectIds = ids
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    return this.organizationModel.find({ _id: { $in: objectIds } }).exec();
  }

  async update(
    id: string,
    data: Partial<Organization>,
  ): Promise<OrganizationDocument | null> {
    return this.organizationModel
      .findByIdAndUpdate(id, data, { new: true })
      .exec();
  }

  countBySlugPrefix(prefix: string): Promise<number> {
    return this.organizationModel
      .countDocuments({ slug: new RegExp(`^${prefix}(-\\d+)?$`) })
      .exec();
  }
}
