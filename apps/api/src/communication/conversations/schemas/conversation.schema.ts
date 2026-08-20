import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { CommunicationChannel, ConversationStatus } from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';

export type ConversationDocument = HydratedDocument<Conversation>;

@Schema({ timestamps: true, collection: 'conversations', toJSON: idToJson })
export class Conversation {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Contact', required: true, index: true })
  contactId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  channel!: CommunicationChannel;

  @Prop()
  subject?: string;

  @Prop({ type: String, default: 'open' })
  status!: ConversationStatus;

  @Prop()
  lastMessageAt?: Date;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);
ConversationSchema.index({ organizationId: 1, status: 1, lastMessageAt: -1 });
ConversationSchema.index({ organizationId: 1, contactId: 1 });
