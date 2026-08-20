import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AiConversation,
  AiConversationDocument,
} from './schemas/ai-conversation.schema';

@Injectable()
export class AiConversationsRepository {
  constructor(
    @InjectModel(AiConversation.name)
    private readonly aiConversationModel: Model<AiConversationDocument>,
  ) {}

  create(data: Partial<AiConversation>): Promise<AiConversationDocument> {
    return this.aiConversationModel.create(data);
  }

  findById(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<AiConversationDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.aiConversationModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
        userId: new Types.ObjectId(userId),
      })
      .exec();
  }

  findAllForUser(
    organizationId: string,
    userId: string,
  ): Promise<AiConversationDocument[]> {
    return this.aiConversationModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
        userId: new Types.ObjectId(userId),
      })
      .sort({ updatedAt: -1 })
      .exec();
  }

  touch(organizationId: string, id: string): Promise<void> {
    return this.aiConversationModel
      .updateOne(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
        },
        { $set: { updatedAt: new Date() } },
      )
      .exec()
      .then(() => undefined);
  }
}
