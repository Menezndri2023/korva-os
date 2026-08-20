import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idToJson } from '../../../core/mongoose/schema-options';

export type NotificationDocument = HydratedDocument<Notification>;

@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'notifications',
  toJSON: idToJson,
})
export class Notification {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  type!: string;

  @Prop({ required: true })
  title!: string;

  @Prop()
  body?: string;

  @Prop()
  link?: string;

  @Prop({ default: false })
  read!: boolean;

  @Prop()
  readAt?: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
NotificationSchema.index({
  organizationId: 1,
  userId: 1,
  read: 1,
  createdAt: -1,
});
