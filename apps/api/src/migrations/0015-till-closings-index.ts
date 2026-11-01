import type { MigrationDefinition } from '../core/migrations/migration.types';

/**
 * till_closings { organizationId, day } unique — one closing per business and day. Production
 * runs with autoIndex OFF, so the index is created here; the same idempotent createIndexes() as
 * 0012 and 0013.
 */
export const migration: MigrationDefinition = {
  name: '0015-till-closings-index',
  async up(connection) {
    for (const name of connection.modelNames()) {
      await connection.model(name).createIndexes();
    }
  },
};

export default migration;
