import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { MessageStatus } from '@korva/types';
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
    return this.messageModel
      .findOneAndUpdate(
        { providerReference },
        { $set: { status } },
        { new: true },
      )
      .exec();
  }
}
