import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { AiMessageRole, AiToolCall } from '@korva/types';
import { idToJson } from '../../core/mongoose/schema-options';

export type AiMessageDocument = HydratedDocument<AiMessage>;

@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'ai_messages',
  toJSON: idToJson,
  // A tool called with no argument stores `input: {}` — minimize would drop it.
  minimize: false,
})
export class AiMessage {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'AiConversation',
    required: true,
    index: true,
  })
  conversationId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  role!: AiMessageRole;

  @Prop()
  content?: string;

  @Prop({ type: [Object] })
  toolCalls?: AiToolCall[];

  @Prop()
  toolCallId?: string;

  @Prop()
  toolName?: string;
}

export const AiMessageSchema = SchemaFactory.createForClass(AiMessage);
AiMessageSchema.index({ organizationId: 1, conversationId: 1, createdAt: 1 });
