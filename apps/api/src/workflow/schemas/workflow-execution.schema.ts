import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type {
  WorkflowActionResult,
  WorkflowExecutionStatus,
} from '@korva/types';
import { WORKFLOW_EXECUTION_STATUSES } from '@korva/types';
import { idToJson } from '../../core/mongoose/schema-options';

export type WorkflowExecutionDocument = HydratedDocument<WorkflowExecution>;

@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'workflow_executions',
  toJSON: idToJson,
})
export class WorkflowExecution {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Workflow', required: true, index: true })
  workflowId!: Types.ObjectId;

  @Prop({ required: true })
  eventName!: string;

  @Prop({ type: Object, required: true })
  payload!: Record<string, unknown>;

  @Prop({ type: String, enum: WORKFLOW_EXECUTION_STATUSES, required: true })
  status!: WorkflowExecutionStatus;

  @Prop({ type: [Object], default: [] })
  actionResults!: WorkflowActionResult[];

  @Prop()
  error?: string;
}

export const WorkflowExecutionSchema =
  SchemaFactory.createForClass(WorkflowExecution);
WorkflowExecutionSchema.index({
  organizationId: 1,
  workflowId: 1,
  createdAt: -1,
});
