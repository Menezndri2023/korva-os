import type { MigrationDefinition } from '../core/migrations/migration.types';

/**
 * ai_usage_logs { createdAt }: KORVA IA's platform-wide monthly spend (the budget guard, re-read
 * at most once a minute, and the administration's system page) scans every organization's calls
 * of the month. Production runs with autoIndex OFF. Same idempotent createIndexes() as 0007.
 */
export const migration: MigrationDefinition = {
  name: '0009-ai-usage-platform-index',
  async up(connection) {
    for (const name of connection.modelNames()) {
      await connection.model(name).createIndexes();
    }
  },
};

export default migration;
