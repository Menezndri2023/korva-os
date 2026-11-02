import type { MigrationDefinition } from '../core/migrations/migration.types';

/**
 * organizations { referralCode } unique sparse and { referredByOrganizationId } — the parrainage
 * code lookup at signup and the referral counts. Production runs with autoIndex OFF, so the
 * indexes are created here; the same idempotent createIndexes() as 0012, 0013 and 0015.
 */
export const migration: MigrationDefinition = {
  name: '0016-referral-indexes',
  async up(connection) {
    for (const name of connection.modelNames()) {
      await connection.model(name).createIndexes();
    }
  },
};

export default migration;
