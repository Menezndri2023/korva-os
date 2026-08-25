import { globalAgent } from 'node:http';

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
 */
process.env.NODE_ENV ??= 'test';
process.env.MONGODB_URI ??=
  'mongodb://korva:korva@localhost:27017/korva_test?authSource=admin&replicaSet=rs0';
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
