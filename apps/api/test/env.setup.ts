/**
 * Loaded once per e2e test file (jest-e2e.json `setupFiles`), before the AppModule
 * (and its ConfigModule env validation) compiles. Points at the same MongoDB/Redis
 * started by `docker compose up -d`, but a dedicated database so tests never touch
 * real dev data.
 */
process.env.NODE_ENV ??= 'test';
process.env.MONGODB_URI ??=
  'mongodb://korva:korva@localhost:27017/korva_test?authSource=admin';
process.env.REDIS_URL ??= 'redis://localhost:6380';
process.env.JWT_SECRET ??= 'test-jwt-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-jwt-refresh-secret';
