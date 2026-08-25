import { globalAgent } from 'node:http';
import { randomUUID } from 'node:crypto';

/**
 * Loaded once per e2e test file (jest-e2e.json `setupFiles`), before the AppModule
 * (and its ConfigModule env validation) compiles. Points at the same MongoDB/Redis
 * started by `docker compose up -d`, but a dedicated database (Mongo) / logical DB
 * index (Redis) so tests never touch real dev data — a dev server left running
 * against the same Redis instance's default db 0 has its own BullMQ workers
 * competing for the same queue names; without this, one of those workers can steal
 * an e2e-published job, process it against the dev Mongo database instead of
 * korva_test, and silently no-op it (confirmed during LOT G3's investigation of an
 * intermittently-failing notification test). Redis's numbered logical databases
 * (SELECT n) give each keyspace/queue full isolation on the same physical instance,
 * with zero code changes: every consumer in this codebase (EventBusService,
 * EventsProcessor, QueueAlertingService, QueueMetricsService,
 * ReconciliationSchedulerService, HealthController) builds its own connection from
 * this same REDIS_URL, so redirecting it here redirects all of them at once.
 *
 * MongoDB database name is derived per-process (not a shared `korva_test`
 * constant): `MONGODB_URI ??=` is only ever assigned once per OS process — Jest
 * re-executes this file's module body for every `*.e2e-spec.ts` file (fresh
 * module sandbox per file, even with `maxWorkers: 1`), but `process.env` itself
 * is a Node process global that survives across those file-scoped re-executions,
 * so the `??=` guard makes the FIRST file's generated name stick for every
 * subsequent file in that same process/run. Two independent Jest processes
 * (e.g. two agents' terminals, or two `--testPathPatterns` invocations launched
 * concurrently) each get their own process and therefore their own database name
 * — eliminating the `MongoServerError: The database is currently being dropped.
 * Database: korva_test` collisions seen when multiple concurrent e2e runs shared
 * the single hardcoded `korva_test` database and raced each other's
 * `connection.dropDatabase()` (see docs/architecture-decisions.md — this is a
 * DIFFERENT failure mode from ADR-003's single-process sequencing issue).
 * `process.pid` alone is not reused within any realistic test run but PIDs *are*
 * recycled by the OS across short-lived processes, so it's combined with a
 * `randomUUID()` computed once at this module's first load for collision-proof
 * uniqueness, plus `JEST_WORKER_ID` so a future `maxWorkers > 1` config would
 * still isolate workers within the same process.
 */
const TEST_RUN_DB_NAME = `korva_test_${process.pid}_${process.env.JEST_WORKER_ID ?? '0'}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

process.env.NODE_ENV ??= 'test';
process.env.MONGODB_URI ??= `mongodb://korva:korva@localhost:27017/${TEST_RUN_DB_NAME}?authSource=admin&replicaSet=rs0`;
process.env.REDIS_URL ??= 'redis://localhost:6380/1';
process.env.JWT_SECRET ??= 'test-jwt-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-jwt-refresh-secret';

// Each e2e spec file boots its own NestApplication (its own ephemeral
// http.Server) but they all run in the same Node process (maxWorkers: 1).
// With keep-alive on, supertest/Node's global http.Agent can hand a socket
// from a PREVIOUS file's (now-closed) server to a request against the NEXT
// file's server, producing garbage responses ("Parse Error: Expected
// HTTP/..."). Disabling keep-alive forces a fresh socket per request.
(globalAgent as unknown as { keepAlive: boolean }).keepAlive = false;
