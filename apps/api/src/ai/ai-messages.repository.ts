import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AiMessage, AiMessageDocument } from './schemas/ai-message.schema';

@Injectable()
export class AiMessagesRepository {
  constructor(
    @InjectModel(AiMessage.name)
    private readonly aiMessageModel: Model<AiMessageDocument>,
  ) {}

  create(data: Partial<AiMessage>): Promise<AiMessageDocument> {
    return this.aiMessageModel.create(data);
  }

  findAllForConversation(
    organizationId: string,
    conversationId: string,
  ): Promise<AiMessageDocument[]> {
    return this.aiMessageModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
        conversationId: new Types.ObjectId(conversationId),
      })
      .sort({ createdAt: 1 })
      .exec();
  }
}
