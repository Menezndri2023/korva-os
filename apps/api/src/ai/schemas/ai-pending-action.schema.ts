import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { AiPendingActionStatus } from '@korva/types';
import { AI_PENDING_ACTION_STATUSES } from '@korva/types';
import { idToJson } from '../../core/mongoose/schema-options';

export type AiPendingActionDocument = HydratedDocument<AiPendingAction>;

@Schema({
  // updatedAt gives the only signal this collection has for how long a row has sat in the
  // non-terminal 'confirming' state — see LOT P4: there is no lease/reclaim mechanism, so this
  // is purely for staleness *observability* (UI/operator), never used to gate a retry.
  timestamps: { createdAt: true, updatedAt: true },
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

  /**
   * Set atomically by AiPendingActionsRepository.claimForConfirmation, in the same
   * findOneAndUpdate that transitions pending → confirming — never written any other way, so it
   * always reflects the single caller that actually won the claim (see LOT P4).
   */
  @Prop({ type: Types.ObjectId, ref: 'User' })
  confirmedBy?: Types.ObjectId;
}

export const AiPendingActionSchema =
  SchemaFactory.createForClass(AiPendingAction);
AiPendingActionSchema.index({ organizationId: 1, status: 1 });
