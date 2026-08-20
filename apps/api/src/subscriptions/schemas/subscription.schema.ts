import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { SubscriptionStatus } from '@korva/types';
import { idToJson } from '../../core/mongoose/schema-options';

export type SubscriptionDocument = HydratedDocument<Subscription>;

@Schema({ timestamps: true, collection: 'subscriptions', toJSON: idToJson })
export class Subscription {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    unique: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Plan', required: true })
  planId!: Types.ObjectId;

  @Prop({ type: String, default: 'active' })
  status!: SubscriptionStatus;

  @Prop({ required: true })
  currentPeriodStart!: Date;

  @Prop({ required: true })
  currentPeriodEnd!: Date;
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);
