import type { MigrationDefinition } from '../core/migrations/migration.types';
import {
  PLAN_KEYS,
  PLAN_LIMITS,
  SUPPORTED_BILLING_CURRENCIES,
  modulesForPlan,
} from '@korva/types';

/**
 * KORVA IA on every plan (2026-10-23, the owner's decision): `ai` moves from Pro to Free in
 * MODULE_MIN_PLAN, and Free/Starter get 30/150 messages a month.
 *
 * 1. Plans: re-sync `modules` and `limits` from the constants, as 0004 and 0006 did — PlansService
 *    seeds with $setOnInsert and EntitlementsService reads the STORED plan, so without this the
 *    code would say "every plan" while production still refused Free and Starter.
 * 2. Organizations: `ai` is added to every organization's enabledModules ($addToSet: nothing is
 *    removed or reordered). A module a business never switched on is invisible to it, so the
 *    decision would otherwise reach only new sign-ups. A business can still switch it off in
 *    Settings, and this migration runs once — it will not switch it back on.
 *
 * Idempotent.
 */
export const migration: MigrationDefinition = {
  name: '0010-korva-ai-all-plans',
  async up(connection) {
    const plans = connection.collection('plans');
    for (const key of PLAN_KEYS) {
      for (const currency of SUPPORTED_BILLING_CURRENCIES) {
        await plans.updateOne(
          { key, priceCurrency: currency },
          {
            $set: {
              modules: modulesForPlan(key),
              limits: PLAN_LIMITS[key],
              updatedAt: new Date(),
            },
          },
        );
      }
    }
    await connection
      .collection('organizations')
      .updateMany({}, { $addToSet: { enabledModules: 'ai' } });
  },
};

export default migration;
