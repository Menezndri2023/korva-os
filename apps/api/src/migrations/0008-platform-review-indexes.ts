import type { MigrationDefinition } from '../core/migrations/migration.types';

/**
 * Builds the indexes added with the reviews of KORVA OS (2026-10-22) — production runs with
 * autoIndex OFF, and 0007 may already have run before them:
 *  - platform_reviews { userId, organizationId } unique: one review of KORVA per user and
 *    business (PlatformReviewsService.upsertMine relies on it under concurrent saves);
 *  - platform_reviews { status, createdAt }: the administration's moderation list.
 *
 * Same createIndexes() over every model as 0007: only adds what is missing, never drops.
 * Idempotent.
 */
export const migration: MigrationDefinition = {
  name: '0008-platform-review-indexes',
  async up(connection) {
    for (const name of connection.modelNames()) {
      await connection.model(name).createIndexes();
    }
  },
};

export default migration;
