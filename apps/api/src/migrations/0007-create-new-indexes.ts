import type { MigrationDefinition } from '../core/migrations/migration.types';

/**
 * Creates the indexes declared since 0001 — production runs with autoIndex OFF (app.module.ts),
 * so a new `@Prop({ unique })` or `Schema.index()` does not exist there until a migration builds
 * it. Two of them matter on 2026-10-21:
 *  - resources { organizationId, isDefault } unique partial: keeps the default bookable resource
 *    (ResourcesService.ensureDefaultResource) to one per organization when two first visitors
 *    arrive at once;
 *  - platform_admins { email } unique: one administrator account per address.
 *
 * createIndexes(), not syncIndexes(): it only ADDS what is missing and never drops an index the
 * schema no longer lists — safer on a live database than 0001's full sync. Idempotent.
 */
export const migration: MigrationDefinition = {
  name: '0007-create-new-indexes',
  async up(connection) {
    for (const name of connection.modelNames()) {
      await connection.model(name).createIndexes();
    }
  },
};

export default migration;
