import { z } from "zod";
import { COURSE_STATUSES, COHORT_STATUSES } from "@korva/types";

export const courseModuleInputSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  durationMinutes: z.number().int().positive().optional(),
  instructorMembershipId: z.string().optional(),
});
export type CourseModuleInput = z.infer<typeof courseModuleInputSchema>;

export const createCourseSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  offerId: z.string().min(1),
  modules: z.array(courseModuleInputSchema).default([]),
});
export type CreateCourseInput = z.infer<typeof createCourseSchema>;

export const updateCourseSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(COURSE_STATUSES).optional(),
  modules: z.array(courseModuleInputSchema).optional(),
});
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;

export const listCoursesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(COURSE_STATUSES).optional(),
});
export type ListCoursesQuery = z.infer<typeof listCoursesQuerySchema>;

export const createCohortSchema = z.object({
  courseId: z.string().min(1),
  name: z.string().min(1).max(200),
  startDate: z.string().datetime(),
  enrolledContactIds: z.array(z.string().min(1)).default([]),
});
export type CreateCohortInput = z.infer<typeof createCohortSchema>;

export const updateCohortSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  status: z.enum(COHORT_STATUSES).optional(),
  enrolledContactIds: z.array(z.string().min(1)).optional(),
});
export type UpdateCohortInput = z.infer<typeof updateCohortSchema>;

export const listCohortsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  courseId: z.string().optional(),
  status: z.enum(COHORT_STATUSES).optional(),
});
export type ListCohortsQuery = z.infer<typeof listCohortsQuerySchema>;

export const scheduleCohortSessionSchema = z
  .object({
    moduleIndex: z.number().int().min(0),
    resourceId: z.string().min(1),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
  })
  .refine((s) => s.startAt < s.endAt, { message: "startAt must be before endAt" });
export type ScheduleCohortSessionInput = z.infer<typeof scheduleCohortSessionSchema>;

export const quizQuestionInputSchema = z
  .object({
    text: z.string().min(1).max(500),
    options: z.array(z.string().min(1).max(200)).min(2).max(8),
    correctOptionIndex: z.number().int().min(0),
  })
  .refine((q) => q.correctOptionIndex < q.options.length, {
    message: "correctOptionIndex must reference one of the given options",
    path: ["correctOptionIndex"],
  });
export type QuizQuestionInput = z.infer<typeof quizQuestionInputSchema>;

export const createQuizSchema = z.object({
  courseId: z.string().min(1),
  moduleIndex: z.number().int().min(0).optional(),
  title: z.string().min(1).max(200),
  questions: z.array(quizQuestionInputSchema).min(1),
  passingScorePercent: z.number().int().min(0).max(100).default(60),
});
export type CreateQuizInput = z.infer<typeof createQuizSchema>;

export const submitQuizAttemptSchema = z.object({
  cohortId: z.string().min(1),
  answers: z.array(z.number().int().min(0)).min(1),
});
export type SubmitQuizAttemptInput = z.infer<typeof submitQuizAttemptSchema>;
