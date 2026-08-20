import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { AiPendingActionStatus } from '@korva/types';
import { AI_PENDING_ACTION_STATUSES } from '@korva/types';
import { idToJson } from '../../core/mongoose/schema-options';

export type AiPendingActionDocument = HydratedDocument<AiPendingAction>;

@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'ai_pending_actions',
  toJSON: idToJson,
})
export class AiPendingAction {
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

  @Prop({ required: true })
  toolName!: string;

  @Prop({ type: Object, required: true })
  input!: Record<string, unknown>;

  @Prop({
    type: String,
    enum: AI_PENDING_ACTION_STATUSES,
    default: 'pending',
  })
  status!: AiPendingActionStatus;
}

export const AiPendingActionSchema =
  SchemaFactory.createForClass(AiPendingAction);
AiPendingActionSchema.index({ organizationId: 1, status: 1 });
