import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Message, MessageDocument } from './schemas/message.schema';

@Injectable()
export class MessagesRepository {
  constructor(
    @InjectModel(Message.name)
    private readonly messageModel: Model<MessageDocument>,
  ) {}

  create(data: Partial<Message>): Promise<MessageDocument> {
    return this.messageModel.create(data);
  }

  findAllForConversation(
    organizationId: string,
    conversationId: string,
  ): Promise<MessageDocument[]> {
    return this.messageModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
        conversationId: new Types.ObjectId(conversationId),
      })
      .sort({ createdAt: 1 })
      .exec();
  }
}
