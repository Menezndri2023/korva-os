export const COURSE_STATUSES = ["draft", "published", "archived"] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

export interface CourseModule {
  title: string;
  description?: string;
  durationMinutes?: number;
  instructorMembershipId?: string;
}

/** A reusable syllabus — an ordered list of Modules, each optionally taught by a different
 *  staff member (multi-instructor). A Course is scheduled by creating one or more Cohorts;
 *  the Course itself carries no dates. `offerId` names the bookable session product used when
 *  a Cohort's module sessions are scheduled as real Bookings (see Cohort's own doc comment). */
export interface Course {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  status: CourseStatus;
  offerId: string;
  modules: CourseModule[];
  createdAt: string;
  updatedAt: string;
}

export const COHORT_STATUSES = ["upcoming", "active", "completed", "cancelled"] as const;
export type CohortStatus = (typeof COHORT_STATUSES)[number];

/** One run of a Course for a group of enrolled learners. Scheduling a module's session
 *  (see CohortSession) creates a real Booking per enrolled contact on the existing Booking
 *  infrastructure — a cohort session IS a group booking, not a new scheduling mechanism. A
 *  learner's module completion is read directly off their own Booking.attended for that
 *  session; no separate progress table is kept. */
export interface Cohort {
  id: string;
  organizationId: string;
  courseId: string;
  name: string;
  startDate: string;
  status: CohortStatus;
  enrolledContactIds: string[];
  createdAt: string;
  updatedAt: string;
}

/** One scheduled module session for a Cohort — the actual real-world class meeting. */
export interface CohortSession {
  id: string;
  organizationId: string;
  cohortId: string;
  moduleIndex: number;
  resourceId: string;
  startAt: string;
  endAt: string;
  instructorMembershipId?: string;
  bookingIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface QuizQuestion {
  text: string;
  options: string[];
  correctOptionIndex: number;
}

/** Tied to a Course, optionally to one specific module (`moduleIndex` undefined = a course-level
 *  final assessment). Learners take it from the customer portal — see QuizAttempt. */
export interface Quiz {
  id: string;
  organizationId: string;
  courseId: string;
  moduleIndex?: number;
  title: string;
  questions: QuizQuestion[];
  passingScorePercent: number;
  createdAt: string;
  updatedAt: string;
}

/** A `Quiz` shape with `correctOptionIndex` stripped from every question — served to a learner
 *  before they've attempted it, so the answer key never round-trips to the browser. */
export type PublicQuiz = Omit<Quiz, "questions"> & {
  questions: Omit<QuizQuestion, "correctOptionIndex">[];
};

export interface QuizAttempt {
  id: string;
  organizationId: string;
  quizId: string;
  cohortId: string;
  contactId: string;
  answers: number[];
  scorePercent: number;
  passed: boolean;
  createdAt: string;
}
