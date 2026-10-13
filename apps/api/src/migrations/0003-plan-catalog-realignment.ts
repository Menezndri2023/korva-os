import type { Types } from 'mongoose';
import type { MigrationDefinition } from '../core/migrations/migration.types';
import {
  PLAN_KEYS,
  PLAN_LIMITS,
  PLAN_NAMES,
  PLAN_PRICES,
  SUPPORTED_BILLING_CURRENCIES,
  modulesForPlan,
} from '@korva/types';

/**
 * Replaces the demonstration plan catalog with the real one, and brings every existing
 * organization back in line with it.
 *
 * PlansService seeds with `$setOnInsert`, which only ever creates — so changing the catalog in
 * code does nothing to a database that already holds the old rows. Production does. It was
 * seeded with what plans.service.ts itself labelled "DEMONSTRATION values", and that catalog had
 * three defects:
 *
 *   1. `free` granted all eleven modules while `starter` granted nine, so paying KORVA removed
 *      `workflow` and `ai` from an organization.
 *   2. `starter` carried `ai_messages_per_month: 100` with no `ai` module, a quota
 *      assertModulesAllowed made it impossible to ever consume.
 *   3. Paid tiers existed only in EUR. PlansService.list filters by the organization's own
 *      currency, so every organization in XOF, MAD, USD or CAD was shown the free plan and
 *      nothing else — the entire West African and Moroccan market could not buy anything.
 *
 * WHAT THIS OVERWRITES. Plan rows are rewritten unconditionally: name, price, modules and
 * limits. That is safe here and would not be in general, so the reasoning matters. The runner
 * records a migration once and never re-runs it, and at the time of writing the only plan rows
 * in existence are the seeded demo ones — scripts/manage-plans.ts, the one way to set a
 * deliberate price, has never been run against production. A price set by hand AFTER this
 * migration is applied is therefore never touched by it. Anyone back-porting this to a database
 * with negotiated prices must check first.
 *
 * ORGANIZATIONS, not just the catalog. `free` losing seven modules leaves every organization
 * created under the old catalog holding `enabledModules` its plan no longer grants: onboarding
 * writes the vertical template's `suggestedModules`, which include `workflow` for all seventeen
 * templates. Nothing re-checks that on read, so those organizations keep working — until the
 * next settings PATCH, where assertModulesAllowed would reject the whole update with a 403 over
 * modules the owner never chose. Clamping each organization to its own plan's module set here is
 * what makes this a repair rather than a trade of one broken state for another.
 *
 * Partial-run safe, as the runner requires: both halves are idempotent writes computed from
 * constants, so re-running from the start after a crash converges on the same result.
 */
/**
 * Shapes for the raw collection handles below. `connection.collection()` is the untyped MongoDB
 * driver, so every field read off a document is `any` without these — which this repo's lint
 * rules reject outright (@typescript-eslint/no-unsafe-assignment), and rightly: a typo in a
 * field name would otherwise sail through and silently clamp nothing.
 *
 * Declared as type aliases rather than interfaces on purpose: the driver's generic is
 * constrained to `Document` (`{ [key: string]: any }`), and TypeScript only gives object type
 * ALIASES an implicit index signature — an interface would not satisfy the constraint.
 */
type PlanRow = {
  _id: Types.ObjectId;
  key: string;
  priceCurrency: string;
};

type SubscriptionRow = {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  planId: Types.ObjectId;
};

type OrganizationRow = {
  _id: Types.ObjectId;
  enabledModules?: string[];
};

export const migration: MigrationDefinition = {
  name: '0003-plan-catalog-realignment',
  async up(connection) {
    const plans = connection.collection<PlanRow>('plans');

    for (const key of PLAN_KEYS) {
      const modules = modulesForPlan(key);
      for (const currency of SUPPORTED_BILLING_CURRENCIES) {
        await plans.updateOne(
          { key, priceCurrency: currency },
          {
            $set: {
              name: PLAN_NAMES[key],
              priceAmount: PLAN_PRICES[currency][key],
              interval: 'month',
              modules,
              limits: PLAN_LIMITS[key],
              updatedAt: new Date(),
            },
            // A tier that was never priced in this currency has no row at all yet. Upserting
            // here rather than leaving it to the next PlansService.ensureSeeded means the
            // catalog is complete the moment the migration finishes, not whenever the API
            // next boots.
            $setOnInsert: {
              key,
              priceCurrency: currency,
              createdAt: new Date(),
            },
          },
          { upsert: true },
        );
      }
    }

    // Second half: clamp organizations to the modules their plan actually grants.
    const organizations =
      connection.collection<OrganizationRow>('organizations');
    const subscriptions =
      connection.collection<SubscriptionRow>('subscriptions');

    // One lookup per plan row, not per organization: the catalog is 20 documents and the
    // organization count is unbounded.
    const planIdToKey = new Map<string, string>();
    for await (const plan of plans.find(
      {},
      { projection: { _id: 1, key: 1 } },
    )) {
      planIdToKey.set(String(plan._id), String(plan.key));
    }

    for await (const subscription of subscriptions.find(
      {},
      { projection: { organizationId: 1, planId: 1 } },
    )) {
      const planKey = planIdToKey.get(String(subscription.planId));
      if (!planKey) continue;

      const allowed = new Set<string>(modulesForPlan(planKey));
      const organization = await organizations.findOne(
        { _id: subscription.organizationId },
        { projection: { enabledModules: 1 } },
      );
      if (!organization) continue;

      const current = organization.enabledModules ?? [];
      const clamped = current.filter((module) => allowed.has(module));
      if (clamped.length === current.length) continue;

      await organizations.updateOne(
        { _id: subscription.organizationId },
        { $set: { enabledModules: clamped, updatedAt: new Date() } },
      );
    }
  },
};

export default migration;
