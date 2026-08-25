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

  /**
   * Atomically reserves exclusive execution rights on a 'pending' action — the single Mongo
   * operation this whole mechanism relies on (see LOT P4: this is deliberately the same
   * findOneAndUpdate-with-status-in-the-filter shape as WorkflowsRepository.claimAction). The
   * filter only matches a row still in 'pending', so at most one concurrent caller can ever see
   * a non-null result for a given action: Mongo serializes writes to a single document, and the
   * filter can never match the row the winner just flipped to 'confirming'. Losers get `null`
   * without ever having touched the row.
   */
  claimForConfirmation(
    organizationId: string,
    id: string,
    userId: string,
  ): Promise<AiPendingActionDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.aiPendingActionModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
          status: 'pending',
        },
        {
          $set: {
            status: 'confirming',
            confirmedBy: new Types.ObjectId(userId),
          },
        },
        { new: true },
      )
      .exec();
  }

  /**
   * Every transition after the initial claim (confirming → confirmed on success, confirming →
   * pending on an ordinary tool error, pending → rejected) is itself a compare-and-swap on the
   * exact source status — `fromStatus` is not a courtesy filter, it's what stops e.g. a losing
   * reject from silently overwriting a status a concurrent confirm has already moved past (see
   * LOT P4 §8/§9). A `null` result means the row was no longer in `fromStatus` by the time this
   * ran — the caller must treat that as "someone else already resolved/claimed it", never retry
   * blindly.
   */
  updateStatus(
    organizationId: string,
    id: string,
    fromStatus: AiPendingActionStatus,
    toStatus: AiPendingActionStatus,
  ): Promise<AiPendingActionDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.aiPendingActionModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
          status: fromStatus,
        },
        { $set: { status: toStatus } },
        { new: true },
      )
      .exec();
  }
}
