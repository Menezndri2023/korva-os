import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idToJson } from '../../../core/mongoose/schema-options';

export type QuizDocument = HydratedDocument<Quiz>;

@Schema({ _id: false })
export class QuizQuestion {
  @Prop({ required: true })
  text!: string;

  @Prop({ type: [String], required: true })
  options!: string[];

  @Prop({ required: true })
  correctOptionIndex!: number;
}
export const QuizQuestionSchema = SchemaFactory.createForClass(QuizQuestion);

@Schema({ timestamps: true, collection: 'quizzes', toJSON: idToJson })
export class Quiz {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Course', required: true, index: true })
  courseId!: Types.ObjectId;

  /** Absent = a course-level final assessment rather than one tied to a specific module. */
  @Prop()
  moduleIndex?: number;

  @Prop({ required: true })
  title!: string;

  @Prop({ type: [QuizQuestionSchema], required: true })
  questions!: QuizQuestion[];

  @Prop({ default: 60 })
  passingScorePercent!: number;
}

export const QuizSchema = SchemaFactory.createForClass(Quiz);
QuizSchema.index({ organizationId: 1, courseId: 1 });

export type QuizAttemptDocument = HydratedDocument<QuizAttempt>;

@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'quiz_attempts',
  toJSON: idToJson,
})
export class QuizAttempt {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Quiz', required: true, index: true })
  quizId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Cohort', required: true })
  cohortId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Contact', required: true, index: true })
  contactId!: Types.ObjectId;

  @Prop({ type: [Number], required: true })
  answers!: number[];

  @Prop({ required: true })
  scorePercent!: number;

  @Prop({ required: true })
  passed!: boolean;
}

export const QuizAttemptSchema = SchemaFactory.createForClass(QuizAttempt);
QuizAttemptSchema.index({ organizationId: 1, quizId: 1, contactId: 1 });
