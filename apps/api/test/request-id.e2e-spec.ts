import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Exercises requestIdMiddleware (see main.ts) against the real HTTP stack — `GET /health` is
 * used purely as an existing @Public() route to reach the middleware without any auth setup;
 * this file is not about health-check behavior itself (see health.e2e-spec.ts for that).
 *
 * `app.use(requestIdMiddleware)` is registered here explicitly, the same way every e2e file
 * already repeats `setGlobalPrefix('api/v1')` itself — building a TestingModule straight from
 * AppModule never runs main.ts's own `bootstrap()`, so anything registered there (helmet,
 * compression, this middleware) has to be replicated by whichever test actually needs it.
 */
describe('Request ID middleware (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(requestIdMiddleware);
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it('TEST 1 — generates a UUID and echoes it on the response when no X-Request-ID is sent', async () => {
    const res = await request(server).get('/api/v1/health').expect(200);

    const requestId = res.headers['x-request-id'];
    expect(requestId).toBeDefined();
    expect(UUID_PATTERN.test(requestId as string)).toBe(true);
  });

  it('TEST 2 — reuses a well-formed X-Request-ID sent by the client', async () => {
    const sentId = '123e4567-e89b-12d3-a456-426614174000';

    const res = await request(server)
      .get('/api/v1/health')
      .set('X-Request-ID', sentId)
      .expect(200);

    expect(res.headers['x-request-id']).toBe(sentId);
  });

  it('TEST 3 — ignores a malformed X-Request-ID and generates a fresh server id instead', async () => {
    const res = await request(server)
      .get('/api/v1/health')
      .set('X-Request-ID', 'invalid-request-id')
      .expect(200);

    const requestId = res.headers['x-request-id'];
    expect(requestId).not.toBe('invalid-request-id');
    expect(UUID_PATTERN.test(requestId as string)).toBe(true);
  });
});
