import type { MigrationDefinition } from '../core/migrations/migration.types';
import {
  PLAN_KEYS,
  SUPPORTED_BILLING_CURRENCIES,
  modulesForPlan,
} from '@korva/types';

/**
 * Re-syncs each plan's `modules` with MODULE_MIN_PLAN after `marketing` moved from Pro to
 * Starter. Starter otherwise granted exactly one module more than the free plan.
 *
 * Needed for the same reason as 0003: PlansService seeds with `$setOnInsert`, so changing the
 * thresholds in code leaves every existing plan document untouched. Without this, production
 * would keep selling Starter without campaigns while the pricing page advertised them.
 *
 * SCOPE IS DELIBERATELY NARROWER THAN 0003 — `modules` only, never price or limits. 0003 could
 * rewrite prices because the only rows in existence were the seeded demonstration values; that
 * is no longer true, and scripts/manage-plans.ts exists precisely so a price can be set or
 * negotiated by hand. A migration whose stated purpose is a module threshold must not quietly
 * reset someone's agreed price.
 *
 * No organization re-clamp either, unlike 0003: a tier only ever GAINS a module here, so every
 * organization's `enabledModules` is still a subset of what its plan grants. Adding the clamp
 * anyway would be dead code pretending to be a safeguard.
 *
 * Idempotent: it writes a value computed from constants, so re-running after a crash converges.
 * It also deliberately syncs every tier rather than just Starter — if a second threshold moves
 * in the same release, this still lands the whole correct picture instead of half of it.
 */
export const migration: MigrationDefinition = {
  name: '0004-marketing-to-starter',
  async up(connection) {
    const plans = connection.collection('plans');
    for (const key of PLAN_KEYS) {
      const modules = modulesForPlan(key);
      for (const currency of SUPPORTED_BILLING_CURRENCIES) {
        await plans.updateOne(
          { key, priceCurrency: currency },
          { $set: { modules, updatedAt: new Date() } },
        );
      }
    }
  },
};

export default migration;
