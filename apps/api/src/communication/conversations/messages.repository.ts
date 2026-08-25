import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MESSAGE_STATUSES, type MessageStatus } from '@korva/types';
import { Message, MessageDocument } from './schemas/message.schema';

/**
 * Relative ordering of MessageStatus values, used only to guard updateStatusByProviderReference
 * below against regressing a message when Resend webhook events arrive out of order — Resend/
 * Svix webhook delivery is at-least-once and makes no ordering guarantee (retries, redelivery),
 * so a stale "delivered" event replayed after a "bounced"/"complained" one must not undo it.
 * "queued"/"sent"/"failed" are the synchronous, pre-webhook states a message starts in; equal
 * ranks (e.g. re-applying the same status) are allowed through as a harmless no-op.
 */
const MESSAGE_STATUS_RANK: Record<MessageStatus, number> = {
  queued: 0,
  sent: 0,
  failed: 0,
  delivered: 1,
  bounced: 2,
  complained: 2,
};

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

  /**
   * Applies an async delivery-status update from the Resend webhook — `providerReference` is the
   * Resend `email_id` we stored on send (see ConversationsService.sendMessage /
   * WorkflowActionsService), which is unique per sent email, so no organization/tenant scoping is
   * needed on the lookup itself. Returns null when no message matches (an event for an email this
   * app never sent, or one already pruned) so the caller can 200-and-ignore rather than error —
   * Resend retries webhook deliveries that don't get a 2xx, and an unrecognized event id is not a
   * reason to trigger those retries.
   */
  updateStatusByProviderReference(
    providerReference: string,
    status: MessageStatus,
  ): Promise<MessageDocument | null> {
    // Atomic ordering guard (see MESSAGE_STATUS_RANK above): only match a message whose current
    // status is at the same rank or "behind" the incoming one, so a delayed/out-of-order webhook
    // event can never move a message backwards. Returns null (same as a genuinely unknown
    // providerReference) when a message exists but a newer status already won — the caller
    // already treats null as "no-op, nothing to apply" either way.
    const allowedPriorStatuses = MESSAGE_STATUSES.filter(
      (candidate) =>
        MESSAGE_STATUS_RANK[candidate] <= MESSAGE_STATUS_RANK[status],
    );
    return this.messageModel
      .findOneAndUpdate(
        { providerReference, status: { $in: allowedPriorStatuses } },
        { $set: { status } },
        { new: true },
      )
      .exec();
  }
}
