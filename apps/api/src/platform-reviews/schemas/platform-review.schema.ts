import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { PlatformReviewStatus } from '@korva/types';
import { PLATFORM_REVIEW_STATUSES } from '@korva/types';
import { idToJson } from '../../core/mongoose/schema-options';

export type PlatformReviewDocument = HydratedDocument<PlatformReview>;

/**
 * A business's review of KORVA OS itself — written from its dashboard, read and moderated by the
 * administration, and shown on korvasuite.com only when the author agreed (`publicConsent`) AND
 * an administrator published it. One per user and organization; editing it sends it back to
 * moderation.
 */
@Schema({ timestamps: true, collection: 'platform_reviews', toJSON: idToJson })
export class PlatformReview {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, min: 1, max: 5 })
  rating!: number;

  @Prop({ required: true })
  comment!: string;

  @Prop({ required: true, default: false })
  publicConsent!: boolean;

  /** Snapshots at writing time — what korvasuite.com would show. */
  @Prop({ required: true })
  displayName!: string;

  @Prop({ required: true })
  businessName!: string;

  @Prop({ type: String, enum: PLATFORM_REVIEW_STATUSES, default: 'pending' })
  status!: PlatformReviewStatus;

  @Prop()
  rejectionReason?: string;

  @Prop()
  moderatedAt?: Date;
}

export const PlatformReviewSchema =
  SchemaFactory.createForClass(PlatformReview);
PlatformReviewSchema.index({ userId: 1, organizationId: 1 }, { unique: true });
PlatformReviewSchema.index({ status: 1, createdAt: -1 });
