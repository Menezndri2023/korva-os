import {
  Controller,
  Get,
  INestApplication,
  Logger,
  Module,
  Param,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { StructuredLogger } from '../src/common/logging/structured-logger.service';
import { Public } from '../src/common/decorators/public.decorator';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A throwaway controller mounted only for TEST 4/5 below — the point of those tests is the
 * requestIdMiddleware -> AsyncLocalStorage -> StructuredLogger pipeline itself, not any real
 * feature endpoint. Nothing in AppModule logs unconditionally on a successful request (the
 * closest candidates, e.g. HealthController, only call `this.logger` on a *failure* path), so a
 * real endpoint can't exercise this deterministically without depending on another module's
 * internals — mounting a tiny `@Public()` controller alongside AppModule in the same
 * TestingModule instead directly proves the actual mechanism main.ts wires up in production.
 */
@Controller('test-logging-probe')
class LoggingProbeController {
  private readonly logger = new Logger(LoggingProbeController.name);

  @Public()
  @Get(':marker')
  handle(@Param('marker') marker: string) {
    this.logger.log(`handling marker=${marker}`);
    return { marker };
  }
}

@Module({ controllers: [LoggingProbeController] })
class LoggingProbeModule {}

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

/**
 * The middleware alone (tested above) only proves the id is generated/echoed — it says nothing
 * about whether it actually reaches the logger, which is the point of this lot (structured
 * logging + request-id correlation). These tests boot a second, separate app instance with
 * `app.useLogger(new StructuredLogger(...))` wired the same way main.ts does it, plus the
 * throwaway probe controller above, and assert on the real JSON lines that come out.
 */
describe('Structured log / request-id correlation (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let logSpy: jest.SpyInstance;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule, LoggingProbeModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(requestIdMiddleware);
    // forceConsole routes through console.log instead of process.stdout.write, so a plain
    // jest.spyOn(console, 'log') below can capture it deterministically.
    app.useLogger(new StructuredLogger({ forceConsole: true }));
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  function logLinesFor(marker: string): Record<string, unknown>[] {
    return logSpy.mock.calls
      .map(([line]: [string]) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.message === `handling marker=${marker}`);
  }

  it('TEST 4 — a log line emitted while handling a request carries that request id', async () => {
    const sentId = 'aaaaaaaa-e89b-12d3-a456-426614174000';

    await request(server)
      .get('/api/v1/test-logging-probe/solo')
      .set('X-Request-ID', sentId)
      .expect(200);

    const lines = logLinesFor('solo');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.requestId).toBe(sentId);
    expect(lines[0]?.context).toBe('LoggingProbeController');
  });

  it('TEST 5 — two concurrent requests never cross request ids in their log lines', async () => {
    const idA = 'bbbbbbbb-e89b-12d3-a456-426614174000';
    const idB = 'cccccccc-e89b-12d3-a456-426614174000';

    await Promise.all([
      request(server)
        .get('/api/v1/test-logging-probe/req-a')
        .set('X-Request-ID', idA)
        .expect(200),
      request(server)
        .get('/api/v1/test-logging-probe/req-b')
        .set('X-Request-ID', idB)
        .expect(200),
    ]);

    const linesA = logLinesFor('req-a');
    const linesB = logLinesFor('req-b');
    expect(linesA).toHaveLength(1);
    expect(linesB).toHaveLength(1);
    expect(linesA[0]?.requestId).toBe(idA);
    expect(linesB[0]?.requestId).toBe(idB);
  });
});
