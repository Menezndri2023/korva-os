import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idToJson } from '../../../core/mongoose/schema-options';

export type TagDocument = HydratedDocument<Tag>;

@Schema({ timestamps: true, collection: 'tags', toJSON: idToJson })
export class Tag {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ required: true })
  name!: string;

  @Prop()
  color?: string;
}

export const TagSchema = SchemaFactory.createForClass(Tag);
TagSchema.index({ organizationId: 1, name: 1 }, { unique: true });
