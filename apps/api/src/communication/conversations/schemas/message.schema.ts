import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { MessageDirection, MessageStatus } from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';

export type MessageDocument = HydratedDocument<Message>;

@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'messages',
  toJSON: idToJson,
})
export class Message {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true,
  })
  conversationId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  direction!: MessageDirection;

  @Prop()
  to?: string;

  @Prop()
  from?: string;

  @Prop()
  subject?: string;

  @Prop({ required: true })
  body!: string;

  @Prop({ type: String, default: 'queued' })
  status!: MessageStatus;

  @Prop()
  providerReference?: string;
}

export const MessageSchema = SchemaFactory.createForClass(Message);
MessageSchema.index({ organizationId: 1, conversationId: 1, createdAt: 1 });
