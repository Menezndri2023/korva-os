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
 * (SELECT n) give each keyspace/queue full isolation from DEV on the same physical
 * instance, with zero code changes: every consumer in this codebase (EventBusService,
 * EventsProcessor, QueueAlertingService, QueueMetricsService,
 * ReconciliationSchedulerService, HealthController) builds its own connection from
 * this same REDIS_URL, so redirecting it here redirects all of them at once. This
 * dev-vs-test isolation says nothing about isolation BETWEEN two concurrent e2e
 * processes sharing the same test DB index — see the `TEST_RUN_REDIS_DB` comment
 * below (WAVE 2.1 / E2E-INFRA-5) for that separate problem, left only
 * partially solved by WAVE 2.1 and closed by WAVE 3's `TEST_RUN_BULLMQ_PREFIX`
 * further below.
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

/**
 * WAVE 2.1 / E2E-INFRA-5 — Redis per-process isolation, and why this is only a
 * PARTIAL analog of the Mongo fix above.
 *
 * The Mongo fix works because a database *name* is an arbitrary string — the
 * `??=` guard lets each process mint a collision-proof, effectively-unbounded
 * name (`pid` + `JEST_WORKER_ID` + a fresh `randomUUID()` slice). Redis has no
 * equivalent unbounded axis available from test infra alone:
 *
 *  - Every BullMQ consumer in this codebase (EventBusService, EventsProcessor,
 *    QueueMetricsService, QueueAlertingService, ReconciliationSchedulerService,
 *    InvoiceOverdueSchedulerService, QuoteExpirySchedulerService) builds its own
 *    `new IORedis(configService.getOrThrow('REDIS_URL'), {...})` /
 *    `new Queue/Worker/QueueEvents(name, { connection, ... })` independently —
 *    there is no shared connection factory and none of them read any
 *    "prefix"-shaped env var today, confirmed by grepping
 *    `apps/api/src/**` for `prefix`, `BULLMQ_PREFIX`, `REDIS_KEY_PREFIX`
 *    (nothing found). So a per-process *BullMQ* `prefix` — the option BullMQ
 *    itself recommends specifically to namespace all of a queue's keys under
 *    the same Redis DB — cannot be injected from `env.setup.ts` alone; it
 *    would require adding `prefix: configService.get('BULLMQ_PREFIX')` to
 *    each of those constructors, i.e. editing business-domain files, which is
 *    out of this file's ownership. See WAVE 2.1 AGENT G's final report
 *    (§11, Cross-agent dependency) for the exact proposed diff.
 *  - The tempting Redis-native workaround — pass a `keyPrefix` on the ioredis
 *    connection itself via a `REDIS_URL` query string (ioredis's own
 *    `parseURL` merges *any* query param into connection options, so this
 *    genuinely requires zero code changes) — was tried and empirically
 *    rejected: BullMQ's `RedisConnection` constructor throws synchronously
 *    ("BullMQ: ioredis does not support ioredis prefixes, use the prefix
 *    option instead") the moment it sees `connection.options.keyPrefix` set,
 *    for any of the Queue/Worker/QueueEvents in `apps/api/src/**`. Confirmed
 *    with a throwaway two-Queue/two-Worker probe against the real dev Redis
 *    before writing this comment — this is not a theoretical concern.
 *
 * What's left, and genuinely achievable from test infra alone, is widening the
 * existing DB-index isolation (dev uses implicit DB 0; test used a hardcoded
 * DB 1) from "fixed, shared by every concurrent e2e process" to "one of 15
 * DB indices (1-15, DB 0 reserved for dev), chosen once per process". Redis's
 * default `databases` config is 16 (confirmed via `CONFIG GET databases`
 * against the docker-compose Redis), so this is a HARD, low ceiling: with N
 * concurrent e2e processes each picking uniformly at random from 15 slots,
 * two of them collide with ~50% probability once N reaches ~5 (birthday
 * paradox), and any two that do land on the same index are back to full
 * cross-process BullMQ job visibility, exactly the original bug. This is
 * strictly better than the old fixed-DB-1 behavior (which guaranteed a
 * collision the instant a second e2e process ran at all) but is NOT the
 * "closes collisions" guarantee the Mongo fix provides — see the final
 * report's Limitations section. `??=` guards this exactly like
 * `TEST_RUN_DB_NAME`/`MONGODB_URI` above: computed fresh on first module load
 * per OS process, then pinned via `process.env` for every subsequent
 * `*.e2e-spec.ts` file Jest re-executes in that same process.
 */
const TEST_RUN_REDIS_DB = 1 + Math.floor(Math.random() * 15);

/**
 * WAVE 3 / E2E-INFRA-5 — closes the gap the comment above documents as
 * "genuinely achievable from test infra alone" being bounded by Redis's
 * 16-DB ceiling. `jest-e2e.json`'s `moduleNameMapper` now resolves every
 * `import ... from 'bullmq'` (including inside the business-domain files
 * this wave may not edit) to `test/support/bullmq-test-prefix.ts`, which
 * injects a BullMQ `prefix` — the option BullMQ itself recommends for
 * namespacing a queue's keys on a shared DB — into every
 * `Queue`/`Worker`/`QueueEvents` constructed anywhere in the module graph
 * *unless* the caller already passed one. Because a BullMQ prefix is an
 * arbitrary string (like `TEST_RUN_DB_NAME` above), it has the same
 * unbounded, collision-proof property the Mongo fix has — no 15-slot
 * birthday-paradox ceiling — so it composes with `TEST_RUN_REDIS_DB` above
 * rather than replacing it: even two processes that land on the same Redis
 * DB index now still get fully isolated BullMQ keyspaces. See
 * `bullmq-test-prefix.ts` for why only `Queue`/`Worker`/`QueueEvents` need
 * wrapping, and `redis-isolation.e2e-spec.ts` for the proof this actually
 * prevents cross-process job consumption on a real Redis instance,
 * including through an unedited business-domain constructor.
 */
const TEST_RUN_BULLMQ_PREFIX = `e2e_${process.pid}_${process.env.JEST_WORKER_ID ?? '0'}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

process.env.NODE_ENV ??= 'test';
process.env.MONGODB_URI ??= `mongodb://korva:korva@localhost:27017/${TEST_RUN_DB_NAME}?authSource=admin&replicaSet=rs0`;
process.env.REDIS_URL ??= `redis://localhost:6380/${TEST_RUN_REDIS_DB}`;
process.env.TEST_RUN_BULLMQ_PREFIX ??= TEST_RUN_BULLMQ_PREFIX;
process.env.JWT_SECRET ??= 'test-jwt-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-jwt-refresh-secret';
process.env.INTEGRATION_CREDENTIALS_KEY ??= 'test-integration-credentials-key';

// Each e2e spec file boots its own NestApplication (its own ephemeral
// http.Server) but they all run in the same Node process (maxWorkers: 1).
// With keep-alive on, supertest/Node's global http.Agent can hand a socket
// from a PREVIOUS file's (now-closed) server to a request against the NEXT
// file's server, producing garbage responses ("Parse Error: Expected
// HTTP/..."). Disabling keep-alive forces a fresh socket per request.
(globalAgent as unknown as { keepAlive: boolean }).keepAlive = false;
