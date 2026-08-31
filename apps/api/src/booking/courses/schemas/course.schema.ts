import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { CourseStatus } from '@korva/types';
import { COURSE_STATUSES } from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';

export type CourseDocument = HydratedDocument<Course>;

@Schema({ _id: false })
export class CourseModule {
  @Prop({ required: true })
  title!: string;

  @Prop()
  description?: string;

  @Prop()
  durationMinutes?: number;

  @Prop({ type: Types.ObjectId, ref: 'Membership' })
  instructorMembershipId?: Types.ObjectId;
}
export const CourseModuleSchema = SchemaFactory.createForClass(CourseModule);

/** A reusable syllabus — see @korva/types courses.ts's own doc comment for the full rationale
 *  (why a Course carries no dates, why module scheduling reuses Booking directly). */
@Schema({ timestamps: true, collection: 'courses', toJSON: idToJson })
export class Course {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ required: true })
  name!: string;

  @Prop()
  description?: string;

  @Prop({ type: String, enum: COURSE_STATUSES, default: 'draft' })
  status!: CourseStatus;

  @Prop({ type: Types.ObjectId, ref: 'Offer', required: true })
  offerId!: Types.ObjectId;

  @Prop({ type: [CourseModuleSchema], default: [] })
  modules!: CourseModule[];
}

export const CourseSchema = SchemaFactory.createForClass(Course);
CourseSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
