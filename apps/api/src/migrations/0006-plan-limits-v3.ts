import type { MigrationDefinition } from '../core/migrations/migration.types';
import {
  PLAN_KEYS,
  PLAN_LIMITS,
  SUPPORTED_BILLING_CURRENCIES,
} from '@korva/types';

/**
 * Re-syncs every plan's `limits` with PLAN_LIMITS after the V3 grid (2026-10-19): seats
 * 1/3/10/25 (Business was unlimited, Starter 5, Pro 15), and three new counted quotas —
 * offers (30 on Free), bookable_staff (3 on Free) and workflows (1/5/unlimited).
 *
 * Needed for the same reason as 0003/0004: PlansService seeds with `$setOnInsert`, so the
 * constants changing in code leaves every stored plan as it was, and EntitlementsService reads
 * the STORED plan. Without this, production would advertise the new grid and enforce the old one.
 *
 * `limits` only — never price or modules, for the reason 0004 gives: a price may have been set
 * by hand with scripts/manage-plans.ts, and a migration about quotas must not reset it.
 *
 * Organizations are not touched. Lowering a limit never removes anything: an organization above
 * one keeps all it has and can only stop adding (EntitlementsService.assertCountWithinLimit,
 * assertSeatAvailable). On 2026-10-19 production holds one organization, on Free with one user.
 *
 * Idempotent: it writes values computed from constants.
 */
export const migration: MigrationDefinition = {
  name: '0006-plan-limits-v3',
  async up(connection) {
    const plans = connection.collection('plans');
    for (const key of PLAN_KEYS) {
      for (const currency of SUPPORTED_BILLING_CURRENCIES) {
        await plans.updateOne(
          { key, priceCurrency: currency },
          { $set: { limits: PLAN_LIMITS[key], updatedAt: new Date() } },
        );
      }
    }
  },
};

export default migration;
