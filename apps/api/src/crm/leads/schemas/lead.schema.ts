import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { CustomFieldValues, LeadStatus } from '@korva/types';
import { LEAD_STATUSES } from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';

export type LeadDocument = HydratedDocument<Lead>;

@Schema({ timestamps: true, collection: 'leads', toJSON: idToJson })
export class Lead {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Contact', required: true, index: true })
  contactId!: Types.ObjectId;

  @Prop()
  source?: string;

  @Prop({ type: Types.ObjectId, ref: 'Pipeline', required: true })
  pipelineId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  stageId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  ownerId?: Types.ObjectId;

  @Prop({ type: String, enum: LEAD_STATUSES, default: 'open' })
  status!: LeadStatus;

  @Prop()
  estimatedValue?: number;

  @Prop()
  probability?: number;

  @Prop({ type: Object, default: {} })
  customFields!: CustomFieldValues;
}

export const LeadSchema = SchemaFactory.createForClass(Lead);
LeadSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
LeadSchema.index({ organizationId: 1, pipelineId: 1, stageId: 1 });
LeadSchema.index({ organizationId: 1, ownerId: 1 });
// Supports LeadsRepository.findAll's `?contactId=` filter — hit on every CRM contact detail
// page load (GET /leads?contactId=X) with no matching index until now (organizationId and
// contactId each had their own single-field index, but Mongo doesn't efficiently intersect two
// single-field indexes for a compound filter the way one compound index does).
LeadSchema.index({ organizationId: 1, contactId: 1, createdAt: -1 });
