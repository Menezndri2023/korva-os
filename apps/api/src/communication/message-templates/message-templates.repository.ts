import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  MessageTemplate,
  MessageTemplateDocument,
} from './schemas/message-template.schema';

@Injectable()
export class MessageTemplatesRepository {
  constructor(
    @InjectModel(MessageTemplate.name)
    private readonly messageTemplateModel: Model<MessageTemplateDocument>,
  ) {}

  create(data: Partial<MessageTemplate>): Promise<MessageTemplateDocument> {
    return this.messageTemplateModel.create(data);
  }

  findAll(organizationId: string): Promise<MessageTemplateDocument[]> {
    return this.messageTemplateModel
      .find({ organizationId: new Types.ObjectId(organizationId) })
      .sort({ name: 1 })
      .exec();
  }

  findById(
    organizationId: string,
    id: string,
  ): Promise<MessageTemplateDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.messageTemplateModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  update(
    organizationId: string,
    id: string,
    data: Partial<MessageTemplate>,
  ): Promise<MessageTemplateDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.messageTemplateModel
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
    const result = await this.messageTemplateModel
      .deleteOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
    return result.deletedCount > 0;
  }
}
