import type { MigrationDefinition } from '../core/migrations/migration.types';

/**
 * Builds every index declared by the Mongoose schemas, explicitly.
 *
 * This exists so `autoIndex` can be turned OFF in production (see app.module.ts). Mongoose
 * defaults it to true, which means every API instance kicks off an index build for every model
 * on every boot — fine on a laptop, a genuine operational hazard against a real cluster with
 * several instances rolling at once and collections large enough for a build to matter.
 *
 * `syncIndexes()` is the same call the e2e suite already makes in its own bootstrap, so this is
 * not a new mechanism — only a new place to invoke it. It creates missing indexes and drops ones
 * no longer declared, which is exactly the "make the database match the schemas" step a deploy
 * wants.
 *
 * Safe to re-run: syncIndexes is idempotent by construction. It is also safe to run while the
 * previous version of the app is still serving, because an index build does not block reads.
 */
export const migration: MigrationDefinition = {
  name: '0001-sync-indexes',
  async up(connection) {
    for (const name of connection.modelNames()) {
      await connection.model(name).syncIndexes();
    }
  },
};

export default migration;
