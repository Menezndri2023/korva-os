import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { TimeEntryStatus } from '@korva/types';
import { TIME_ENTRY_STATUSES } from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';

export type TimeEntryDocument = HydratedDocument<TimeEntry>;

@Schema({ timestamps: true, collection: 'time_entries', toJSON: idToJson })
export class TimeEntry {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Contact', required: true })
  contactId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  date!: Date;

  @Prop({ required: true })
  durationMinutes!: number;

  @Prop({ required: true })
  description!: string;

  @Prop({ default: true })
  billable!: boolean;

  @Prop()
  hourlyRate?: number;

  @Prop({ required: true })
  currency!: string;

  @Prop({ type: String, enum: TIME_ENTRY_STATUSES, default: 'unbilled' })
  status!: TimeEntryStatus;

  @Prop({ type: Types.ObjectId, ref: 'Invoice' })
  invoiceId?: Types.ObjectId;

  @Prop()
  notes?: string;
}

export const TimeEntrySchema = SchemaFactory.createForClass(TimeEntry);
TimeEntrySchema.index({ organizationId: 1, status: 1, date: -1 });
TimeEntrySchema.index({ organizationId: 1, contactId: 1, status: 1 });
TimeEntrySchema.index({ organizationId: 1, userId: 1, date: -1 });
TimeEntrySchema.index({ organizationId: 1, invoiceId: 1 }, { sparse: true });
