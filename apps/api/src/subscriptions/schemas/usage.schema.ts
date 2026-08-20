import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idToJson } from '../../core/mongoose/schema-options';

export type UsageDocument = HydratedDocument<Usage>;

/** One document per (organizationId, metric, period) — period is "YYYY-MM", incremented via $inc upsert. */
@Schema({ timestamps: true, collection: 'usage', toJSON: idToJson })
export class Usage {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ required: true })
  metric!: string;

  @Prop({ required: true })
  period!: string;

  @Prop({ default: 0 })
  count!: number;
}

export const UsageSchema = SchemaFactory.createForClass(Usage);
UsageSchema.index(
  { organizationId: 1, metric: 1, period: 1 },
  { unique: true },
);
