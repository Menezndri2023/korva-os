import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  Conversation,
  ConversationDocument,
} from './schemas/conversation.schema';

export interface FindConversationsOptions {
  page: number;
  limit: number;
  contactId?: string;
  status?: string;
  channel?: string;
}
export interface Paginated<T> {
  data: T[];
  total: number;
}

@Injectable()
export class ConversationsRepository {
  constructor(
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
  ) {}

  create(data: Partial<Conversation>): Promise<ConversationDocument> {
    return this.conversationModel.create(data);
  }

  findById(
    organizationId: string,
    id: string,
  ): Promise<ConversationDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.conversationModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  async findAll(
    organizationId: string,
    options: FindConversationsOptions,
  ): Promise<Paginated<ConversationDocument>> {
    const filter: FilterQuery<Conversation> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (options.contactId) {
      filter.contactId = new Types.ObjectId(options.contactId);
    }
    if (options.status) filter.status = options.status;
    if (options.channel) filter.channel = options.channel;

    const skip = (options.page - 1) * options.limit;
    const [data, total] = await Promise.all([
      this.conversationModel
        .find(filter)
        .sort({ lastMessageAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(options.limit)
        .exec(),
      this.conversationModel.countDocuments(filter).exec(),
    ]);

    return { data, total };
  }

  update(
    organizationId: string,
    id: string,
    data: Partial<Conversation>,
  ): Promise<ConversationDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.conversationModel
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
}
