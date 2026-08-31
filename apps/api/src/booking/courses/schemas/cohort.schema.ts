import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { CohortStatus } from '@korva/types';
import { COHORT_STATUSES } from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';

export type CohortDocument = HydratedDocument<Cohort>;

@Schema({ timestamps: true, collection: 'cohorts', toJSON: idToJson })
export class Cohort {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Course', required: true, index: true })
  courseId!: Types.ObjectId;

  @Prop({ required: true })
  name!: string;

  @Prop({ required: true })
  startDate!: Date;

  @Prop({ type: String, enum: COHORT_STATUSES, default: 'upcoming' })
  status!: CohortStatus;

  @Prop({ type: [Types.ObjectId], ref: 'Contact', default: [] })
  enrolledContactIds!: Types.ObjectId[];
}

export const CohortSchema = SchemaFactory.createForClass(Cohort);
CohortSchema.index({ organizationId: 1, courseId: 1 });
// Supports "which cohorts is this learner enrolled in" (the customer-portal listing) without a
// collection scan.
CohortSchema.index({ organizationId: 1, enrolledContactIds: 1 });

export type CohortSessionDocument = HydratedDocument<CohortSession>;

/** One scheduled module session for a Cohort — see @korva/types courses.ts's own doc comment. */
@Schema({ timestamps: true, collection: 'cohort_sessions', toJSON: idToJson })
export class CohortSession {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Cohort', required: true, index: true })
  cohortId!: Types.ObjectId;

  @Prop({ required: true })
  moduleIndex!: number;

  @Prop({ type: Types.ObjectId, ref: 'Resource', required: true })
  resourceId!: Types.ObjectId;

  @Prop({ required: true })
  startAt!: Date;

  @Prop({ required: true })
  endAt!: Date;

  @Prop({ type: Types.ObjectId, ref: 'Membership' })
  instructorMembershipId?: Types.ObjectId;

  @Prop({ type: [Types.ObjectId], ref: 'Booking', default: [] })
  bookingIds!: Types.ObjectId[];
}

export const CohortSessionSchema = SchemaFactory.createForClass(CohortSession);
CohortSessionSchema.index({ organizationId: 1, cohortId: 1 });
