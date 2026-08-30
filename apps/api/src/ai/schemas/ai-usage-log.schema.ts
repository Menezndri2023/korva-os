import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idToJson } from '../../core/mongoose/schema-options';
import { AI_AGENTS, type AiAgent } from '@korva/types';

export type AiUsageLogDocument = HydratedDocument<AiUsageLog>;

/** One document per real model call (see AiUsageLog in @korva/types for the field-level rationale). */
@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'ai_usage_logs',
  toJSON: idToJson,
})
export class AiUsageLog {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'AiConversation', required: true })
  conversationId!: Types.ObjectId;

  @Prop({ enum: AI_AGENTS, required: true })
  agent!: AiAgent;

  @Prop({ required: true })
  model!: string;

  @Prop({ required: true })
  inputTokens!: number;

  @Prop({ required: true })
  outputTokens!: number;

  @Prop({ type: Number, default: null })
  costUsd!: number | null;
}

export const AiUsageLogSchema = SchemaFactory.createForClass(AiUsageLog);
AiUsageLogSchema.index({ organizationId: 1, createdAt: 1 });
