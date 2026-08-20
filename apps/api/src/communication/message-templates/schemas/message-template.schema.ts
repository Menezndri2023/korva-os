import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { CommunicationChannel } from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';

export type MessageTemplateDocument = HydratedDocument<MessageTemplate>;

@Schema({ timestamps: true, collection: 'message_templates', toJSON: idToJson })
export class MessageTemplate {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ required: true })
  name!: string;

  @Prop({ type: String, required: true })
  channel!: CommunicationChannel;

  @Prop()
  subject?: string;

  @Prop({ required: true })
  body!: string;
}

export const MessageTemplateSchema =
  SchemaFactory.createForClass(MessageTemplate);
MessageTemplateSchema.index({ organizationId: 1, channel: 1 });
