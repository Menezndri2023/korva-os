import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { AiAgent } from '@korva/types';
import { idToJson } from '../../core/mongoose/schema-options';

export type AiConversationDocument = HydratedDocument<AiConversation>;

@Schema({ timestamps: true, collection: 'ai_conversations', toJSON: idToJson })
export class AiConversation {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  agent!: AiAgent;

  @Prop()
  title?: string;
}

export const AiConversationSchema =
  SchemaFactory.createForClass(AiConversation);
// Matches AiConversationsRepository.findAllForUser's actual sort (`updatedAt`, so the most
// recently active conversation surfaces first — touch() bumps updatedAt on every new message) —
// previously indexed on createdAt instead, a mismatch that forced an in-memory sort.
AiConversationSchema.index({ organizationId: 1, userId: 1, updatedAt: -1 });
