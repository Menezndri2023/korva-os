import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { CampaignRecipientStatus } from '@korva/types';
import { CAMPAIGN_RECIPIENT_STATUSES } from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';

export type CampaignRecipientDocument = HydratedDocument<CampaignRecipient>;

@Schema({
  timestamps: true,
  collection: 'campaign_recipients',
  toJSON: idToJson,
})
export class CampaignRecipient {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Campaign', required: true, index: true })
  campaignId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Contact', required: true })
  contactId!: Types.ObjectId;

  @Prop({ type: String, enum: CAMPAIGN_RECIPIENT_STATUSES, default: 'pending' })
  status!: CampaignRecipientStatus;

  @Prop({ type: String, enum: ['whatsapp', 'email'] })
  channelUsed?: 'whatsapp' | 'email';

  @Prop()
  error?: string;

  @Prop()
  sentAt?: Date;
}

export const CampaignRecipientSchema =
  SchemaFactory.createForClass(CampaignRecipient);
// Idempotency guard: a re-triggered launch (retry, double-click) can never enqueue the same
// contact twice for the same campaign — see CampaignsService.launch's insertMany(ordered:false).
CampaignRecipientSchema.index(
  { campaignId: 1, contactId: 1 },
  { unique: true },
);
CampaignRecipientSchema.index({ campaignId: 1, status: 1 });
