import type { MigrationDefinition } from '../src/core/migrations/migration.types';

/**
 * Replaces Plan's old `unique: { key }` index with the compound `unique: { key, priceCurrency }`
 * that multi-currency pricing needs (see plan.schema.ts).
 *
 * Needs its own migration rather than relying on 0001-sync-indexes: that one is already
 * recorded as applied on any database it has run against, so it will never run again — and a
 * database still carrying the single-field unique index would reject the second currency's
 * document for a tier with a duplicate-key error.
 *
 * Only the Plan model is synced, deliberately narrow: syncIndexes() drops indexes a schema no
 * longer declares, and a migration whose stated purpose is one collection's index should not be
 * able to drop another collection's by accident.
 *
 * Safe to re-run — syncIndexes is idempotent — and safe on a fresh database, where the old
 * index never existed and this simply creates the new one.
 */
export const migration: MigrationDefinition = {
  name: '0002-plan-currency-index',
  async up(connection) {
    await connection.model('Plan').syncIndexes();
  },
};

export default migration;
