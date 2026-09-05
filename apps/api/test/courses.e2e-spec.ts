import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

interface ApiSuccess<T> {
  success: true;
  data: T;
}
interface ApiError {
  success: false;
  error: { code: string; message: string };
}
interface AuthPayload {
  accessToken: string;
}
interface OrganizationPayload {
  id: string;
}
interface CoursePayload {
  id: string;
  status: string;
  modules: { title: string }[];
}
interface CohortPayload {
  id: string;
  status: string;
  enrolledContactIds: string[];
}
interface CohortSessionPayload {
  id: string;
  moduleIndex: number;
  bookingIds: string[];
  instructorMembershipId?: string;
}
interface QuizPayload {
  id: string;
  questions: { correctOptionIndex: number }[];
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

/** A fixed future date+hour, never relative to "now" — a `now + Nh` offset can cross the UTC
 *  midnight boundary depending on what time this suite happens to run, which trips a real
 *  pre-existing bug in availability.service.ts#isWithinWeeklyWindows (a booking whose window
 *  straddles the day boundary is wrongly rejected even with a full 00:00-23:59 availability
 *  window) — already documented elsewhere in this codebase, not something this suite should
 *  work around by disabling the assertion. Always mid-day UTC, so it's safe regardless of the
 *  real wall-clock time this suite runs at. */
function fixedSlot(
  daysFromNow: number,
  hour: number,
): { startAt: string; endAt: string } {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + daysFromNow);
  start.setUTCHours(hour, 0, 0, 0);
  const end = new Date(start.getTime() + 3_600_000);
  return { startAt: start.toISOString(), endAt: end.toISOString() };
}

describe('Courses / Cohorts / Quizzes (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  let accessToken: string;
  let organizationId: string;
  let learnerAId: string;
  let learnerBId: string;
  let offerId: string;
  let resourceId: string;
  let instructorMembershipId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    server = app.getHttpServer();
    connection = app.get(getConnectionToken());
    await connection.dropDatabase();
    await Promise.all(
      connection
        .modelNames()
        .map((name) => connection.model(name).syncIndexes()),
    );

    const authRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email: 'courses-owner@example.com', password: 'password123' })
      .expect(201);
    accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Academy Org',
        type: 'formation',
        country: 'FR',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        language: 'fr',
      })
      .expect(201);
    organizationId = asSuccess<OrganizationPayload>(orgRes.body).id;

    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ enabledModules: ['crm', 'catalog', 'booking'] })
      .expect(200);

    const learnerARes = await request(server)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ type: 'person', firstName: 'Learner', lastName: 'A' })
      .expect(201);
    learnerAId = asSuccess<{ id: string }>(learnerARes.body).id;

    const learnerBRes = await request(server)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ type: 'person', firstName: 'Learner', lastName: 'B' })
      .expect(201);
    learnerBId = asSuccess<{ id: string }>(learnerBRes.body).id;

    const offerRes = await request(server)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        type: 'booking',
        name: 'Session de formation',
        status: 'active',
        pricing: { amount: 100, currency: 'EUR' },
      })
      .expect(201);
    offerId = asSuccess<{ id: string }>(offerRes.body).id;

    const resourceRes = await request(server)
      .post('/api/v1/resources')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        name: 'Salle A',
        type: 'room',
        capacity: 10,
        weeklyAvailability: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
          dayOfWeek,
          startTime: '00:00',
          endTime: '23:59',
        })),
      })
      .expect(201);
    resourceId = asSuccess<{ id: string }>(resourceRes.body).id;

    const memberRes = await request(server)
      .get('/api/v1/organizations/me/members')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    instructorMembershipId = asSuccess<{ id: string }[]>(memberRes.body)[0]!.id;
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();
  });

  let courseId: string;

  it('creates a course with an instructor-assigned module', async () => {
    const res = await request(server)
      .post('/api/v1/courses')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        name: 'Développement Web',
        offerId,
        modules: [
          { title: 'Introduction', instructorMembershipId },
          { title: 'Projet final' },
        ],
      })
      .expect(201);
    const course = asSuccess<CoursePayload>(res.body);
    courseId = course.id;
    expect(course.status).toBe('draft');
    expect(course.modules).toHaveLength(2);
  });

  it('rejects creating a course for a nonexistent offer', async () => {
    const res = await request(server)
      .post('/api/v1/courses')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ name: 'Ghost', offerId: '000000000000000000000000', modules: [] })
      .expect(404);
    expect(asError(res.body).code).toBe('OFFER_NOT_FOUND');
  });

  it('rejects a course module referencing a nonexistent instructor', async () => {
    const res = await request(server)
      .post('/api/v1/courses')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        name: 'Ghost Instructor',
        offerId,
        modules: [
          {
            title: 'Intro',
            instructorMembershipId: '000000000000000000000000',
          },
        ],
      })
      .expect(400);
    expect(asError(res.body).code).toBe('INSTRUCTOR_NOT_FOUND');
  });

  let cohortId: string;

  it('creates a cohort enrolling two learners', async () => {
    const res = await request(server)
      .post('/api/v1/cohorts')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        courseId,
        name: 'Promo Septembre',
        startDate: new Date().toISOString(),
        enrolledContactIds: [learnerAId, learnerBId],
      })
      .expect(201);
    const cohort = asSuccess<CohortPayload>(res.body);
    cohortId = cohort.id;
    expect(cohort.status).toBe('upcoming');
    expect(cohort.enrolledContactIds).toHaveLength(2);
  });

  it('schedules module 0 as a real booking for every enrolled learner, carrying the instructor through', async () => {
    const { startAt, endAt } = fixedSlot(7, 10);

    const res = await request(server)
      .post(`/api/v1/cohorts/${cohortId}/sessions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ moduleIndex: 0, resourceId, startAt, endAt })
      .expect(201);
    const session = asSuccess<CohortSessionPayload>(res.body);
    expect(session.bookingIds).toHaveLength(2);
    expect(session.instructorMembershipId).toBe(instructorMembershipId);

    // Each generated booking is a completely ordinary Booking — reusing the existing GET.
    const bookingRes = await request(server)
      .get(`/api/v1/bookings/${session.bookingIds[0]}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    expect(asSuccess<{ resourceId: string }>(bookingRes.body).resourceId).toBe(
      resourceId,
    );
  });

  it('rejects scheduling the same module twice for the same cohort', async () => {
    const { startAt, endAt } = fixedSlot(8, 10);

    const res = await request(server)
      .post(`/api/v1/cohorts/${cohortId}/sessions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ moduleIndex: 0, resourceId, startAt, endAt })
      .expect(400);
    expect(asError(res.body).code).toBe('COHORT_SESSION_ALREADY_SCHEDULED');
  });

  it('rejects scheduling a cohort that exceeds the resource capacity', async () => {
    const tinyResourceRes = await request(server)
      .post('/api/v1/resources')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        name: 'Petite salle',
        type: 'room',
        capacity: 1,
        weeklyAvailability: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
          dayOfWeek,
          startTime: '00:00',
          endTime: '23:59',
        })),
      })
      .expect(201);
    const tinyResourceId = asSuccess<{ id: string }>(tinyResourceRes.body).id;

    const { startAt, endAt } = fixedSlot(9, 10);
    const res = await request(server)
      .post(`/api/v1/cohorts/${cohortId}/sessions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ moduleIndex: 1, resourceId: tinyResourceId, startAt, endAt })
      .expect(400);
    expect(asError(res.body).code).toBe('COHORT_EXCEEDS_RESOURCE_CAPACITY');
  });

  it('lists the cohort sessions scheduled so far', async () => {
    const res = await request(server)
      .get(`/api/v1/cohorts/${cohortId}/sessions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    expect(asSuccess<CohortSessionPayload[]>(res.body)).toHaveLength(1);
  });

  describe('multi-instructor scheduling: double-booking guard + calendar visibility', () => {
    let secondCourseId: string;
    let secondCohortId: string;
    let secondResourceId: string;

    beforeAll(async () => {
      const courseRes = await request(server)
        .post('/api/v1/courses')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'Cours parallèle',
          offerId,
          // Same instructor as module 0 of the first course, already booked at fixedSlot(7, 10).
          modules: [{ title: 'Module unique', instructorMembershipId }],
        })
        .expect(201);
      secondCourseId = asSuccess<CoursePayload>(courseRes.body).id;

      const cohortRes = await request(server)
        .post('/api/v1/cohorts')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          courseId: secondCourseId,
          name: 'Promo parallèle',
          startDate: new Date().toISOString(),
          enrolledContactIds: [learnerAId],
        })
        .expect(201);
      secondCohortId = asSuccess<CohortPayload>(cohortRes.body).id;

      const resourceRes = await request(server)
        .post('/api/v1/resources')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'Salle B',
          type: 'room',
          capacity: 10,
          weeklyAvailability: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
            dayOfWeek,
            startTime: '00:00',
            endTime: '23:59',
          })),
        })
        .expect(201);
      secondResourceId = asSuccess<{ id: string }>(resourceRes.body).id;
    });

    it('rejects scheduling the same instructor on an overlapping slot in a different cohort/course', async () => {
      // Overlaps the first course's already-scheduled 10:00-11:00 session exactly.
      const { startAt, endAt } = fixedSlot(7, 10);

      const res = await request(server)
        .post(`/api/v1/cohorts/${secondCohortId}/sessions`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ moduleIndex: 0, resourceId: secondResourceId, startAt, endAt })
        .expect(400);
      expect(asError(res.body).code).toBe('INSTRUCTOR_ALREADY_BOOKED');
    });

    it('allows the same instructor to teach a non-overlapping slot', async () => {
      const { startAt, endAt } = fixedSlot(7, 14); // same day, no overlap with 10:00-11:00

      const res = await request(server)
        .post(`/api/v1/cohorts/${secondCohortId}/sessions`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ moduleIndex: 0, resourceId: secondResourceId, startAt, endAt })
        .expect(201);
      expect(
        asSuccess<CohortSessionPayload>(res.body).instructorMembershipId,
      ).toBe(instructorMembershipId);
    });

    it("lists this instructor's full teaching schedule across both courses", async () => {
      const res = await request(server)
        .get(`/api/v1/cohorts/instructors/${instructorMembershipId}/sessions`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const sessions = asSuccess<CohortSessionPayload[]>(res.body);
      expect(sessions).toHaveLength(2);
      expect(
        sessions.every(
          (s) => s.instructorMembershipId === instructorMembershipId,
        ),
      ).toBe(true);
    });
  });

  it('creates a quiz for a module and never exposes correctOptionIndex on the public shape', async () => {
    const res = await request(server)
      .post('/api/v1/quizzes')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        courseId,
        moduleIndex: 0,
        title: 'Quiz Introduction',
        questions: [
          {
            text: 'Combien font 2+2 ?',
            options: ['3', '4', '5'],
            correctOptionIndex: 1,
          },
        ],
        passingScorePercent: 50,
      })
      .expect(201);
    const quiz = asSuccess<QuizPayload>(res.body);
    expect(quiz.questions[0]!.correctOptionIndex).toBe(1);
  });

  it('rejects a quiz question whose correctOptionIndex is out of range', async () => {
    const res = await request(server)
      .post('/api/v1/quizzes')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        courseId,
        title: 'Bad quiz',
        questions: [{ text: 'Q', options: ['a', 'b'], correctOptionIndex: 5 }],
      })
      .expect(400);
    expect(asError(res.body).code).toBe('VALIDATION_ERROR');
  });
});
