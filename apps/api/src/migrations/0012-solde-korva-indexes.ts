import type { MigrationDefinition } from '../core/migrations/migration.types';

/**
 * Le Solde KORVA: wallet_entries { sourceKey } unique (a payment is credited once, whatever
 * webhook or sweep sees it first), payouts { organizationId, open } partial unique (one open
 * withdrawal per business), wallet_settings { organizationId } unique, and the listing indexes.
 * These uniques ARE the money's safety, and production runs with autoIndex OFF — so this must be
 * applied before the first online sale. Same idempotent createIndexes() as 0007.
 */
export const migration: MigrationDefinition = {
  name: '0012-solde-korva-indexes',
  async up(connection) {
    for (const name of connection.modelNames()) {
      await connection.model(name).createIndexes();
    }
  },
};

export default migration;
