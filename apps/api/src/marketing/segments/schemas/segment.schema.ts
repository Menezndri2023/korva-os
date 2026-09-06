import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { SegmentCriteria } from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';

export type SegmentDocument = HydratedDocument<Segment>;

@Schema({ timestamps: true, collection: 'segments', toJSON: idToJson })
export class Segment {
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
  description?: string;

  /** Stored as-is (the versioned SegmentCriteria DSL) — interpreted only by
   *  segment-query-builder.ts, never queried against directly. */
  @Prop({ type: Object, required: true })
  criteria!: SegmentCriteria;
}

export const SegmentSchema = SchemaFactory.createForClass(Segment);
SegmentSchema.index({ organizationId: 1, name: 1 });
