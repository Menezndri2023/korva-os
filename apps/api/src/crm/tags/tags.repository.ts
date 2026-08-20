import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Tag, TagDocument } from './schemas/tag.schema';

@Injectable()
export class TagsRepository {
  constructor(
    @InjectModel(Tag.name) private readonly tagModel: Model<TagDocument>,
  ) {}

  create(data: Partial<Tag>): Promise<TagDocument> {
    return this.tagModel.create(data);
  }

  findAllForOrganization(organizationId: string): Promise<TagDocument[]> {
    return this.tagModel
      .find({ organizationId: new Types.ObjectId(organizationId) })
      .exec();
  }

  findByName(
    organizationId: string,
    name: string,
  ): Promise<TagDocument | null> {
    return this.tagModel
      .findOne({ organizationId: new Types.ObjectId(organizationId), name })
      .exec();
  }
}
