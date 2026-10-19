import type { MigrationDefinition } from '../core/migrations/migration.types';
import { VERTICAL_TEMPLATES } from '@korva/types';

/**
 * Fills Organization.businessModel for organizations created before the field existed.
 *
 * Derived the only way the codebase could know it until now: their free-text `type` matching a
 * trade's `suggestedType` exactly (what verticalForOrganizationType does). An organization whose
 * `type` matches no trade is left without one — guessing would put a business on the wrong kind
 * of site, and every reader of the field already falls back to the older behaviour when it is
 * absent. The owner can set it in Settings.
 *
 * Never overwrites: only documents where the field does not exist are touched, so a value an
 * owner chose (or onboarding stored) is safe, and re-running after a crash converges.
 *
 * In production on 2026-10-19 this concerns one organization, `freeworld` (type "commerce"),
 * which becomes "retail".
 */
export const migration: MigrationDefinition = {
  name: '0005-business-model-backfill',
  async up(connection) {
    const organizations = connection.collection('organizations');
    for (const template of VERTICAL_TEMPLATES) {
      await organizations.updateMany(
        { type: template.suggestedType, businessModel: { $exists: false } },
        {
          $set: {
            businessModel: template.businessModel,
            updatedAt: new Date(),
          },
        },
      );
    }
  },
};

export default migration;
