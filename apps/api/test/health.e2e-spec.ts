import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

interface ApiSuccess<T> {
  success: true;
  data: T;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}

/**
 * Deliberately does not assert on exact counts, or wait for any job to reach a particular
 * state — doing so would mean either creating real business entities to fire a Lot Q event
 * (touching producers, out of scope for Lot R) or depending on the reconciliation scheduler's
 * own timing (disabled in the test environment — see reconciliation-scheduler.service.ts).
 * This only proves the endpoint reaches both real queues over the real test Redis and returns
 * the expected shape — the counts being correct BullMQ numbers is already covered against a
 * mocked Queue in queue-metrics.service.spec.ts.
 */
describe('Health module — GET /health/queues (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with numeric counts for both the events and payment-reconciliation queues, unauthenticated', async () => {
    const res = await request(server).get('/api/v1/health/queues').expect(200);
    const metrics = asSuccess<Record<string, Record<string, unknown>>>(res.body);

    expect(Object.keys(metrics).sort()).toEqual(
      ['events', 'payment-reconciliation'].sort(),
    );
    for (const counts of Object.values(metrics)) {
      expect(Object.keys(counts).sort()).toEqual(
        ['active', 'completed', 'delayed', 'failed', 'paused', 'waiting'].sort(),
      );
      for (const value of Object.values(counts)) {
        expect(typeof value).toBe('number');
        expect(Number.isFinite(value as number)).toBe(true);
      }
    }
  });

  it('never includes job-level or tenant-identifying fields in the response', async () => {
    const res = await request(server).get('/api/v1/health/queues').expect(200);
    const serialized = JSON.stringify(res.body);

    for (const forbidden of [
      'organizationId',
      'entityId',
      'eventKey',
      'jobId',
      'payload',
      'workflowId',
      'actionIndex',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
