import type { MigrationDefinition } from '../core/migrations/migration.types';

/**
 * platform_notes { organizationId, createdAt } — the administration's internal notes on a
 * business, listed newest first. Production runs with autoIndex OFF, so the index is created
 * here; the same idempotent createIndexes() as 0012.
 */
export const migration: MigrationDefinition = {
  name: '0013-platform-notes-index',
  async up(connection) {
    for (const name of connection.modelNames()) {
      await connection.model(name).createIndexes();
    }
  },
};

export default migration;
