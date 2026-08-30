import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { TaskStatus } from '@korva/types';
import { TASK_STATUSES } from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';

export type TaskDocument = HydratedDocument<Task>;

@Schema({ timestamps: true, collection: 'tasks', toJSON: idToJson })
export class Task {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ required: true })
  title!: string;

  @Prop()
  description?: string;

  @Prop({ type: String, enum: ['contact', 'lead'] })
  entity?: 'contact' | 'lead';

  @Prop({ type: Types.ObjectId })
  entityId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  assigneeId?: Types.ObjectId;

  @Prop()
  dueAt?: Date;

  @Prop({ type: String, enum: TASK_STATUSES, default: 'pending' })
  status!: TaskStatus;
}

export const TaskSchema = SchemaFactory.createForClass(Task);
TaskSchema.index({ organizationId: 1, status: 1, dueAt: 1 });
TaskSchema.index({ organizationId: 1, assigneeId: 1, status: 1 });
// Supports TasksRepository.findAll's `?entity=&entityId=` filter — hit on every CRM contact AND
// lead detail page load (GET /tasks?entity=contact&entityId=X), previously unindexed.
TaskSchema.index({ organizationId: 1, entity: 1, entityId: 1 });
