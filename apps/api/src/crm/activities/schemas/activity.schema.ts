import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { ActivityType } from '@korva/types';
import { ACTIVITY_TYPES } from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';

export type ActivityDocument = HydratedDocument<Activity>;

@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'activities',
  toJSON: idToJson,
})
export class Activity {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: String, enum: ['contact', 'lead'], required: true })
  entity!: 'contact' | 'lead';

  @Prop({ type: Types.ObjectId, required: true, index: true })
  entityId!: Types.ObjectId;

  @Prop({ type: String, enum: ACTIVITY_TYPES, required: true })
  type!: ActivityType;

  @Prop()
  content?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  authorId?: Types.ObjectId;
}

export const ActivitySchema = SchemaFactory.createForClass(Activity);
ActivitySchema.index({
  organizationId: 1,
  entity: 1,
  entityId: 1,
  createdAt: -1,
});
