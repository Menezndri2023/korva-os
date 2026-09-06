import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { CustomFieldValues, DealStatus } from '@korva/types';
import { DEAL_STATUSES } from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';

export type DealDocument = HydratedDocument<Deal>;

@Schema({ timestamps: true, collection: 'deals', toJSON: idToJson })
export class Deal {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Contact', required: true, index: true })
  contactId!: Types.ObjectId;

  /** The lead this deal was converted from, when applicable — absent for deals created
   *  directly via POST /deals. Non-unique: a lead could in principle spawn more than one deal
   *  over its lifetime; LeadsService.convertToDeal enforces at most one at conversion time. */
  @Prop({ type: Types.ObjectId, ref: 'Lead' })
  leadId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Pipeline', required: true })
  pipelineId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  stageId!: Types.ObjectId;

  @Prop()
  estimatedValue?: number;

  @Prop()
  probability?: number;

  @Prop({ type: String, enum: DEAL_STATUSES, default: 'open' })
  status!: DealStatus;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  ownerId?: Types.ObjectId;

  @Prop({ type: Object, default: {} })
  customFields!: CustomFieldValues;

  @Prop()
  closedAt?: Date;

  @Prop()
  lossReason?: string;
}

export const DealSchema = SchemaFactory.createForClass(Deal);
DealSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
DealSchema.index({ organizationId: 1, pipelineId: 1, stageId: 1 });
DealSchema.index({ organizationId: 1, ownerId: 1 });
DealSchema.index({ organizationId: 1, contactId: 1, createdAt: -1 });
DealSchema.index({ organizationId: 1, leadId: 1 });
