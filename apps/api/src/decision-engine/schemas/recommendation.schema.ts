import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type {
  ActionCenterSeverity,
  RecommendationEntityType,
  RecommendationStatus,
} from '@korva/types';
import {
  ACTION_CENTER_SEVERITIES,
  RECOMMENDATION_STATUSES,
} from '@korva/types';
import { idToJson } from '../../core/mongoose/schema-options';

export type RecommendationDocument = HydratedDocument<Recommendation>;

@Schema({ timestamps: true, collection: 'recommendations', toJSON: idToJson })
export class Recommendation {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  /** Stable rule identifier (e.g. 'invoice_overdue_followup') — not a closed enum, see
   *  RecommendationRuleKey in @korva/types: new rules never need a schema migration. */
  @Prop({ required: true })
  ruleKey!: string;

  @Prop({ required: true })
  title!: string;

  @Prop({ required: true })
  description!: string;

  @Prop({ required: true })
  entityType!: RecommendationEntityType;

  @Prop({ type: Types.ObjectId, required: true })
  entityId!: Types.ObjectId;

  @Prop({ type: String, enum: RECOMMENDATION_STATUSES, default: 'open' })
  status!: RecommendationStatus;

  @Prop({
    type: String,
    enum: ACTION_CENTER_SEVERITIES,
    default: 'recommendation',
  })
  severity!: ActionCenterSeverity;

  @Prop()
  impact?: string;

  @Prop()
  confidence?: number;
}

export const RecommendationSchema =
  SchemaFactory.createForClass(Recommendation);
RecommendationSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
// Enforces DecisionEngineService's one-shot-per-rule-per-entity dedup at the database level —
// a rule re-evaluating the same entity (e.g. a retried BullMQ job, or the same event arriving
// twice) must never create a second Recommendation for it, whatever its current status.
RecommendationSchema.index(
  { organizationId: 1, ruleKey: 1, entityType: 1, entityId: 1 },
  { unique: true },
);
