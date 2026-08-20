import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { CustomFieldEntity, CustomFieldType } from '@korva/types';
import { CUSTOM_FIELD_ENTITIES, CUSTOM_FIELD_TYPES } from '@korva/types';
import { idToJson } from '../../core/mongoose/schema-options';

export type CustomFieldDocument = HydratedDocument<CustomField>;

@Schema({ timestamps: true, collection: 'custom_fields', toJSON: idToJson })
export class CustomField {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: String, enum: CUSTOM_FIELD_ENTITIES, required: true })
  entity!: CustomFieldEntity;

  @Prop({ required: true })
  key!: string;

  @Prop({ required: true })
  label!: string;

  @Prop({ type: String, enum: CUSTOM_FIELD_TYPES, required: true })
  type!: CustomFieldType;

  @Prop({ type: [String], default: undefined })
  options?: string[];

  @Prop({ default: false })
  required!: boolean;
}

export const CustomFieldSchema = SchemaFactory.createForClass(CustomField);
CustomFieldSchema.index(
  { organizationId: 1, entity: 1, key: 1 },
  { unique: true },
);
