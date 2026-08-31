import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { ProjectStatus } from '@korva/types';
import { PROJECT_STATUSES } from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';

export type ProjectDocument = HydratedDocument<Project>;

/** A client-engagement container — see @korva/types projects.ts's own doc comment for the
 *  full rationale. Lives in CrmModule (parallel to Contacts/Tasks) rather than a new top-level
 *  module: FinanceModule already imports CrmModule (for ContactsService), so TimeEntriesService
 *  can inject ProjectsService directly with zero new module-import edges. */
@Schema({ timestamps: true, collection: 'projects', toJSON: idToJson })
export class Project {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Contact', required: true, index: true })
  contactId!: Types.ObjectId;

  @Prop({ required: true })
  name!: string;

  @Prop()
  description?: string;

  @Prop({ type: String, enum: PROJECT_STATUSES, default: 'active' })
  status!: ProjectStatus;

  @Prop()
  budgetHours?: number;

  @Prop()
  budgetAmount?: number;

  @Prop()
  currency?: string;

  @Prop()
  startDate?: Date;

  @Prop()
  endDate?: Date;
}

export const ProjectSchema = SchemaFactory.createForClass(Project);
ProjectSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
ProjectSchema.index({ organizationId: 1, contactId: 1 });
