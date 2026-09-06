import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { CampaignStats, CampaignStatus } from '@korva/types';
import { CAMPAIGN_STATUSES } from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';

export type CampaignDocument = HydratedDocument<Campaign>;

@Schema({ _id: false })
export class CampaignStatsSubdocument implements CampaignStats {
  @Prop({ default: 0 })
  totalRecipients!: number;

  @Prop({ default: 0 })
  processedCount!: number;

  @Prop({ default: 0 })
  sentCount!: number;

  @Prop({ default: 0 })
  failedCount!: number;

  @Prop({ default: 0 })
  skippedCount!: number;
}

export const CampaignStatsSchema = SchemaFactory.createForClass(
  CampaignStatsSubdocument,
);

@Schema({ timestamps: true, collection: 'campaigns', toJSON: idToJson })
export class Campaign {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ required: true })
  name!: string;

  @Prop({ type: Types.ObjectId, ref: 'Segment', required: true })
  segmentId!: Types.ObjectId;

  @Prop()
  subject?: string;

  /** Freeform, with {{contact.x}} placeholders — see apps/api/src/shared/template.ts. */
  @Prop({ required: true })
  body!: string;

  @Prop({ type: String, enum: CAMPAIGN_STATUSES, default: 'draft' })
  status!: CampaignStatus;

  @Prop({ type: CampaignStatsSchema, default: () => ({}) })
  stats!: CampaignStats;

  @Prop()
  launchedAt?: Date;

  @Prop()
  completedAt?: Date;
}

export const CampaignSchema = SchemaFactory.createForClass(Campaign);
CampaignSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
