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

  /**
   * `limit` defaults to a sane cap (see AiOrchestratorService.listConversations) rather than
   * returning every conversation a user has ever had — this was previously fully unbounded, a
   * latent risk as AI usage grows. `page`/`limit` are accepted for forward compatibility, but the
   * response stays a plain array (not the {data, pagination} envelope other list endpoints use)
   * so the existing `GET /ai/conversations` contract — and the frontend page consuming it —
   * doesn't change for the default, no-query-params call.
   */
  findAllForUser(
    organizationId: string,
    userId: string,
    options: { page: number; limit: number },
  ): Promise<AiConversationDocument[]> {
    const skip = (options.page - 1) * options.limit;
    return this.aiConversationModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
        userId: new Types.ObjectId(userId),
      })
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(options.limit)
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
