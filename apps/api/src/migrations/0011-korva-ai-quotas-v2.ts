import type { MigrationDefinition } from '../core/migrations/migration.types';
import {
  PLAN_KEYS,
  PLAN_LIMITS,
  SUPPORTED_BILLING_CURRENCIES,
} from '@korva/types';

/**
 * KORVA IA quotas raised (2026-10-23) to 100 / 500 / 2 000 / 6 000 messages a month after
 * measuring a real model's cost per question — see PLAN_LIMITS' own comment. Re-syncs every
 * stored plan's `limits` (EntitlementsService enforces the STORED plan; PlansService seeds with
 * $setOnInsert). Limits only, never prices or modules. Idempotent.
 */
export const migration: MigrationDefinition = {
  name: '0011-korva-ai-quotas-v2',
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
