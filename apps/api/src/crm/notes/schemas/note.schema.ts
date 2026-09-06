import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idToJson } from '../../../core/mongoose/schema-options';

export type NoteDocument = HydratedDocument<Note>;

@Schema({ timestamps: true, collection: 'notes', toJSON: idToJson })
export class Note {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: String, enum: ['contact', 'lead', 'deal'], required: true })
  entity!: 'contact' | 'lead' | 'deal';

  @Prop({ type: Types.ObjectId, required: true, index: true })
  entityId!: Types.ObjectId;

  @Prop({ required: true })
  content!: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  authorId?: Types.ObjectId;
}

export const NoteSchema = SchemaFactory.createForClass(Note);
NoteSchema.index({ organizationId: 1, entity: 1, entityId: 1, createdAt: -1 });
