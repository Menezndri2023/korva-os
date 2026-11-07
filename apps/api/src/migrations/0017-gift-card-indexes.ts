import type { MigrationDefinition } from '../core/migrations/migration.types';

/**
 * gift_cards { organizationId, code } unique — a card's code names exactly one card per business.
 * Production runs with autoIndex OFF, so the index is created here; the same idempotent
 * createIndexes() as 0012, 0013, 0015 and 0016.
 */
export const migration: MigrationDefinition = {
  name: '0017-gift-card-indexes',
  async up(connection) {
    for (const name of connection.modelNames()) {
      await connection.model(name).createIndexes();
    }
  },
};

export default migration;
