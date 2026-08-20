import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { WorkflowAction, WorkflowCondition } from '@korva/types';
import { idToJson } from '../../core/mongoose/schema-options';

export type WorkflowDocument = HydratedDocument<Workflow>;

@Schema({ _id: false })
export class WorkflowConditionDoc implements WorkflowCondition {
  @Prop({ required: true })
  field!: string;

  @Prop({ type: String, required: true })
  operator!: WorkflowCondition['operator'];

  @Prop({ type: Object, required: true })
  value!: string | number | boolean;
}
export const WorkflowConditionSchema =
  SchemaFactory.createForClass(WorkflowConditionDoc);

@Schema({ _id: false })
export class WorkflowActionDoc {
  @Prop({ type: String, required: true })
  type!: WorkflowAction['type'];

  @Prop({ type: Object, required: true })
  config!: WorkflowAction['config'];
}
export const WorkflowActionSchema =
  SchemaFactory.createForClass(WorkflowActionDoc);

@Schema({ timestamps: true, collection: 'workflows', toJSON: idToJson })
export class Workflow {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ required: true })
  name!: string;

  @Prop({ required: true, index: true })
  trigger!: string;

  @Prop({ default: true })
  active!: boolean;

  @Prop({ type: [WorkflowConditionSchema], default: [] })
  conditions!: WorkflowConditionDoc[];

  @Prop({ type: [WorkflowActionSchema], required: true })
  actions!: WorkflowActionDoc[];
}

export const WorkflowSchema = SchemaFactory.createForClass(Workflow);
WorkflowSchema.index({ organizationId: 1, trigger: 1, active: 1 });
