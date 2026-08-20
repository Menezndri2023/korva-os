import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Resource,
  ResourceDocument,
  BlockedSlot,
} from './schemas/resource.schema';

@Injectable()
export class ResourcesRepository {
  constructor(
    @InjectModel(Resource.name)
    private readonly resourceModel: Model<ResourceDocument>,
  ) {}

  create(data: Partial<Resource>): Promise<ResourceDocument> {
    return this.resourceModel.create(data);
  }

  findById(
    organizationId: string,
    id: string,
  ): Promise<ResourceDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.resourceModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  findAll(
    organizationId: string,
    activeOnly: boolean,
  ): Promise<ResourceDocument[]> {
    const filter: Record<string, unknown> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (activeOnly) filter.active = true;
    return this.resourceModel.find(filter).sort({ name: 1 }).exec();
  }

  async update(
    organizationId: string,
    id: string,
    data: Partial<Resource>,
  ): Promise<ResourceDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.resourceModel
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

  async addBlockedSlot(
    organizationId: string,
    id: string,
    slot: Partial<BlockedSlot>,
  ): Promise<ResourceDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.resourceModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
        },
        { $push: { blockedSlots: slot } },
        { new: true },
      )
      .exec();
  }

  async removeBlockedSlot(
    organizationId: string,
    id: string,
    slotId: string,
  ): Promise<ResourceDocument | null> {
    if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(slotId))
      return null;
    return this.resourceModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
        },
        { $pull: { blockedSlots: { _id: new Types.ObjectId(slotId) } } },
        { new: true },
      )
      .exec();
  }
}
