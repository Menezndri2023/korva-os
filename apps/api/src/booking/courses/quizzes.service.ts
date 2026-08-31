import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type { PublicQuiz } from '@korva/types';
import type {
  CreateQuizInput,
  SubmitQuizAttemptInput,
} from '@korva/validation';
import { QuizzesRepository } from './quizzes.repository';
import { QuizAttemptDocument, QuizDocument } from './schemas/quiz.schema';
import { CoursesService } from './courses.service';
import { CohortsService } from './cohorts.service';

@Injectable()
export class QuizzesService {
  constructor(
    private readonly quizzesRepository: QuizzesRepository,
    private readonly coursesService: CoursesService,
    private readonly cohortsService: CohortsService,
  ) {}

  async create(
    organizationId: string,
    input: CreateQuizInput,
  ): Promise<QuizDocument> {
    const course = await this.coursesService.getById(
      organizationId,
      input.courseId,
    );
    if (input.moduleIndex !== undefined && !course.modules[input.moduleIndex]) {
      throw new BadRequestException({
        code: 'COURSE_MODULE_NOT_FOUND',
        message: `Course has no module at index ${input.moduleIndex}`,
      });
    }

    return this.quizzesRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      courseId: new Types.ObjectId(input.courseId),
      moduleIndex: input.moduleIndex,
      title: input.title,
      questions: input.questions,
      passingScorePercent: input.passingScorePercent,
    });
  }

  async getById(organizationId: string, id: string): Promise<QuizDocument> {
    const quiz = await this.quizzesRepository.findById(organizationId, id);
    if (!quiz) {
      throw new NotFoundException({
        code: 'QUIZ_NOT_FOUND',
        message: 'Quiz not found',
      });
    }
    return quiz;
  }

  listByCourse(
    organizationId: string,
    courseId: string,
  ): Promise<QuizDocument[]> {
    return this.quizzesRepository.findByCourse(organizationId, courseId);
  }

  /** Strips the answer key — see PublicQuiz's own doc comment in @korva/types. */
  toPublic(quiz: QuizDocument): PublicQuiz {
    return {
      id: quiz.id as string,
      organizationId: quiz.organizationId.toString(),
      courseId: quiz.courseId.toString(),
      moduleIndex: quiz.moduleIndex,
      title: quiz.title,
      questions: quiz.questions.map((q) => ({
        text: q.text,
        options: q.options,
      })),
      passingScorePercent: quiz.passingScorePercent,
      createdAt: (
        quiz as unknown as { createdAt: Date }
      ).createdAt.toISOString(),
      updatedAt: (
        quiz as unknown as { updatedAt: Date }
      ).updatedAt.toISOString(),
    };
  }

  /**
   * Eligibility: the contact must be enrolled in the given cohort, and that cohort must be
   * running the quiz's own course — a learner can't submit an attempt for a quiz belonging to a
   * course they aren't actually enrolled in via this cohort. Scoring happens entirely
   * server-side (never trusts a client-computed score) by comparing each answer against the
   * question's real correctOptionIndex, which is never sent to the client (see toPublic).
   */
  async submitAttempt(
    organizationId: string,
    contactId: string,
    quizId: string,
    input: SubmitQuizAttemptInput,
  ): Promise<QuizAttemptDocument> {
    const quiz = await this.getById(organizationId, quizId);
    const cohort = await this.cohortsService.getById(
      organizationId,
      input.cohortId,
    );
    if (cohort.courseId.toString() !== quiz.courseId.toString()) {
      throw new BadRequestException({
        code: 'QUIZ_COHORT_MISMATCH',
        message: 'This cohort is not running the course this quiz belongs to',
      });
    }
    const isEnrolled = cohort.enrolledContactIds.some(
      (id) => id.toString() === contactId,
    );
    if (!isEnrolled) {
      throw new BadRequestException({
        code: 'NOT_ENROLLED_IN_COHORT',
        message: 'You are not enrolled in this cohort',
      });
    }
    if (input.answers.length !== quiz.questions.length) {
      throw new BadRequestException({
        code: 'QUIZ_ANSWER_COUNT_MISMATCH',
        message: `This quiz has ${quiz.questions.length} questions, but ${input.answers.length} answers were submitted`,
      });
    }

    const correctCount = quiz.questions.filter(
      (question, index) => question.correctOptionIndex === input.answers[index],
    ).length;
    const scorePercent = Math.round(
      (correctCount / quiz.questions.length) * 100,
    );
    const passed = scorePercent >= quiz.passingScorePercent;

    return this.quizzesRepository.createAttempt({
      organizationId: new Types.ObjectId(organizationId),
      quizId: new Types.ObjectId(quizId),
      cohortId: new Types.ObjectId(input.cohortId),
      contactId: new Types.ObjectId(contactId),
      answers: input.answers,
      scorePercent,
      passed,
    });
  }

  listAttemptsForContact(
    organizationId: string,
    quizId: string,
    contactId: string,
  ): Promise<QuizAttemptDocument[]> {
    return this.quizzesRepository.findAttemptsForContact(
      organizationId,
      quizId,
      contactId,
    );
  }
}
