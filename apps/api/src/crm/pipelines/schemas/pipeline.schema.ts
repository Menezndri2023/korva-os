import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PipelineDocument = HydratedDocument<Pipeline>;

@Schema({ _id: true })
export class PipelineStage {
  @Prop({ required: true })
  name!: string;

  @Prop({ required: true })
  order!: number;

  @Prop()
  probability?: number;
}
export const PipelineStageSchema = SchemaFactory.createForClass(PipelineStage);

@Schema({
  timestamps: true,
  collection: 'pipelines',
  toJSON: {
    virtuals: true,
    transform: (_doc, ret: Record<string, unknown>) => {
      ret.id = String(ret._id);
      delete ret._id;
      delete ret.__v;
      if (Array.isArray(ret.stages)) {
        ret.stages = (ret.stages as Record<string, unknown>[]).map((stage) => {
          const { _id, ...rest } = stage;
          return { id: String(_id), ...rest };
        });
      }
      return ret;
    },
  },
})
export class Pipeline {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ required: true })
  name!: string;

  @Prop({ default: false })
  isDefault!: boolean;

  @Prop({ type: [PipelineStageSchema], required: true })
  stages!: PipelineStage[];
}

export const PipelineSchema = SchemaFactory.createForClass(Pipeline);
