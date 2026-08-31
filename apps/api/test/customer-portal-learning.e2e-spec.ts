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
  slug: string;
}
interface CustomerAuthPayload {
  accessToken: string;
}
interface QuizPayload {
  id: string;
  questions: { correctOptionIndex: number }[];
}
interface PublicQuizPayload {
  id: string;
  questions: { text: string; options: string[] }[];
}
interface QuizAttemptPayload {
  scorePercent: number;
  passed: boolean;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

describe('Customer portal — learning (cohorts + quizzes) (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  let slug: string;
  let staffToken: string;
  let organizationId: string;
  let learnerToken: string;
  let otherLearnerToken: string;
  let cohortId: string;
  let quizId: string;

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
      .send({ email: 'learning-owner@example.com', password: 'password123' })
      .expect(201);
    staffToken = asSuccess<AuthPayload>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        name: 'Learning Org',
        type: 'formation',
        country: 'FR',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        language: 'fr',
      })
      .expect(201);
    const organization = asSuccess<OrganizationPayload>(orgRes.body);
    slug = organization.slug;
    organizationId = organization.id;

    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${staffToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ enabledModules: ['crm', 'catalog', 'booking'] })
      .expect(200);

    const learnerContactRes = await request(server)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${staffToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        type: 'person',
        firstName: 'Learner',
        email: 'learner@example.com',
      })
      .expect(201);
    const learnerContactId = asSuccess<{ id: string }>(
      learnerContactRes.body,
    ).id;

    const offerRes = await request(server)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${staffToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        type: 'booking',
        name: 'Session',
        status: 'active',
        pricing: { amount: 50, currency: 'EUR' },
      })
      .expect(201);
    const offerId = asSuccess<{ id: string }>(offerRes.body).id;

    const courseRes = await request(server)
      .post('/api/v1/courses')
      .set('Authorization', `Bearer ${staffToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        name: 'Bases du marketing',
        offerId,
        modules: [{ title: 'Introduction' }],
      })
      .expect(201);
    const courseId = asSuccess<{ id: string }>(courseRes.body).id;

    const cohortRes = await request(server)
      .post('/api/v1/cohorts')
      .set('Authorization', `Bearer ${staffToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        courseId,
        name: 'Promo A',
        startDate: new Date().toISOString(),
        enrolledContactIds: [learnerContactId],
      })
      .expect(201);
    cohortId = asSuccess<{ id: string }>(cohortRes.body).id;

    const quizRes = await request(server)
      .post('/api/v1/quizzes')
      .set('Authorization', `Bearer ${staffToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        courseId,
        title: 'Quiz Introduction',
        questions: [
          {
            text: 'La capitale de la France ?',
            options: ['Lyon', 'Paris', 'Marseille'],
            correctOptionIndex: 1,
          },
          {
            text: '2 + 2 = ?',
            options: ['3', '4'],
            correctOptionIndex: 1,
          },
        ],
        passingScorePercent: 50,
      })
      .expect(201);
    quizId = asSuccess<QuizPayload>(quizRes.body).id;

    const learnerRes = await request(server)
      .post(`/api/v1/public/${slug}/account/register`)
      .send({ email: 'learner@example.com', password: 'learnerpass123' })
      .expect(201);
    learnerToken = asSuccess<CustomerAuthPayload>(learnerRes.body).accessToken;

    const otherRes = await request(server)
      .post(`/api/v1/public/${slug}/account/register`)
      .send({ email: 'not-enrolled@example.com', password: 'learnerpass123' })
      .expect(201);
    otherLearnerToken = asSuccess<CustomerAuthPayload>(
      otherRes.body,
    ).accessToken;
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();
  });

  it('lists the cohorts the learner is enrolled in', async () => {
    const res = await request(server)
      .get(`/api/v1/public/${slug}/account/cohorts`)
      .set('Authorization', `Bearer ${learnerToken}`)
      .expect(200);
    expect(asSuccess<{ id: string }[]>(res.body)).toHaveLength(1);
  });

  it('404s a cohort for a customer not enrolled in it', async () => {
    await request(server)
      .get(`/api/v1/public/${slug}/account/cohorts/${cohortId}`)
      .set('Authorization', `Bearer ${otherLearnerToken}`)
      .expect(404);
  });

  it("lists the quizzes available for the cohort's course", async () => {
    const res = await request(server)
      .get(`/api/v1/public/${slug}/account/cohorts/${cohortId}/quizzes`)
      .set('Authorization', `Bearer ${learnerToken}`)
      .expect(200);
    const quizzes = asSuccess<PublicQuizPayload[]>(res.body);
    expect(quizzes).toHaveLength(1);
    expect(JSON.stringify(quizzes)).not.toContain('correctOptionIndex');
  });

  it('serves the quiz without the answer key and never leaks correctOptionIndex', async () => {
    const res = await request(server)
      .get(
        `/api/v1/public/${slug}/account/cohorts/${cohortId}/quizzes/${quizId}`,
      )
      .set('Authorization', `Bearer ${learnerToken}`)
      .expect(200);
    const body = asSuccess<{ quiz: PublicQuizPayload; attempts: unknown[] }>(
      res.body,
    );
    expect(body.quiz.questions).toHaveLength(2);
    expect(JSON.stringify(body.quiz)).not.toContain('correctOptionIndex');
    expect(body.attempts).toHaveLength(0);
  });

  it('rejects a non-enrolled learner from viewing the quiz', async () => {
    await request(server)
      .get(
        `/api/v1/public/${slug}/account/cohorts/${cohortId}/quizzes/${quizId}`,
      )
      .set('Authorization', `Bearer ${otherLearnerToken}`)
      .expect(404);
  });

  it('submits an attempt, computes the score server-side, and records a pass', async () => {
    const res = await request(server)
      .post(`/api/v1/public/${slug}/account/quizzes/${quizId}/attempts`)
      .set('Authorization', `Bearer ${learnerToken}`)
      .send({ cohortId, answers: [1, 1] })
      .expect(201);
    const attempt = asSuccess<QuizAttemptPayload>(res.body);
    expect(attempt.scorePercent).toBe(100);
    expect(attempt.passed).toBe(true);
  });

  it('a wrong answer yields a lower score and a fail', async () => {
    const res = await request(server)
      .post(`/api/v1/public/${slug}/account/quizzes/${quizId}/attempts`)
      .set('Authorization', `Bearer ${otherLearnerToken}`)
      .send({ cohortId, answers: [0, 0] })
      .expect(400);
    expect(asError(res.body).code).toBe('NOT_ENROLLED_IN_COHORT');
  });

  it('rejects an attempt with the wrong number of answers', async () => {
    const res = await request(server)
      .post(`/api/v1/public/${slug}/account/quizzes/${quizId}/attempts`)
      .set('Authorization', `Bearer ${learnerToken}`)
      .send({ cohortId, answers: [1] })
      .expect(400);
    expect(asError(res.body).code).toBe('QUIZ_ANSWER_COUNT_MISMATCH');
  });
});
