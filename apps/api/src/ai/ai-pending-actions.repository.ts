import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AiPendingActionStatus } from '@korva/types';
import {
  AiPendingAction,
  AiPendingActionDocument,
} from './schemas/ai-pending-action.schema';

@Injectable()
export class AiPendingActionsRepository {
  constructor(
    @InjectModel(AiPendingAction.name)
    private readonly aiPendingActionModel: Model<AiPendingActionDocument>,
  ) {}

  create(data: Partial<AiPendingAction>): Promise<AiPendingActionDocument> {
    return this.aiPendingActionModel.create(data);
  }

  findAllForConversation(
    organizationId: string,
    conversationId: string,
  ): Promise<AiPendingActionDocument[]> {
    return this.aiPendingActionModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
        conversationId: new Types.ObjectId(conversationId),
      })
      .sort({ createdAt: 1 })
      .exec();
  }

  findById(
    organizationId: string,
    id: string,
  ): Promise<AiPendingActionDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.aiPendingActionModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  updateStatus(
    organizationId: string,
    id: string,
    status: AiPendingActionStatus,
  ): Promise<AiPendingActionDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.aiPendingActionModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
        },
        { status },
        { new: true },
      )
      .exec();
  }
}
