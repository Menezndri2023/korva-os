/**
 * One-time, idempotent backfill adding the new "website" module to existing organizations.
 *
 * NOT a reuse of backfill-enabled-modules.ts: that script is intentionally intersect-only
 * ("never add a module the organization hadn't already chosen") — but every existing
 * organization already has a non-empty enabledModules (set at creation time from its plan), so
 * an intersect-only script can never propagate a brand-new module to it. This script is the
 * opposite, deliberately additive policy: give every org the new module its own plan already
 * grants, since "website" (the org's own hosted storefront) was previously unconditional
 * infrastructure with no on/off switch at all — every org effectively already had it.
 *
 * Rule applied per organization: if the organization's active plan includes "website" and its
 * enabledModules doesn't yet, add it. Never touches an org whose plan doesn't grant "website" at
 * all (e.g. a plan an operator deliberately excluded it from via manage-plans.ts).
 *
 * Run AFTER re-seeding/updating existing Plan documents to include "website" in their `modules`
 * (plans.service.ts's DEFAULT_PLANS only seeds brand-new databases — see plans.repository.ts's
 * upsertByKey, which is insert-only and never touches an already-existing Plan document):
 *   pnpm --filter @korva/api exec ts-node -r ./scripts/support/ts-extension-resolver.cjs -r tsconfig-paths/register scripts/manage-plans.ts --key free --modules <...,website> --apply
 *   (repeat per plan key: free, starter, pro, business, and any custom plan)
 *
 * Then run this script:
 *   pnpm --filter @korva/api exec ts-node -r ./scripts/support/ts-extension-resolver.cjs -r tsconfig-paths/register scripts/backfill-website-module.ts            (dry run, default)
 *   pnpm --filter @korva/api exec ts-node -r ./scripts/support/ts-extension-resolver.cjs -r tsconfig-paths/register scripts/backfill-website-module.ts --apply    (writes changes)
 *
 * Idempotent: re-running with nothing left to fix makes zero writes.
 */
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppModule } from '../src/app.module';
import {
  Organization,
  OrganizationDocument,
} from '../src/organizations/schemas/organization.schema';
import { SubscriptionsService } from '../src/subscriptions/subscriptions.service';

async function run() {
  const apply = process.argv.includes('--apply');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const organizationModel = app.get<Model<OrganizationDocument>>(
      getModelToken(Organization.name),
    );
    const subscriptionsService = app.get(SubscriptionsService);

    const organizations = await organizationModel.find().exec();

    let unchanged = 0;
    let wouldChange = 0;
    let changed = 0;
    let skippedNoSubscription = 0;
    let skippedPlanExcludesWebsite = 0;

    console.log(
      `${apply ? 'APPLY' : 'DRY RUN'} — inspecting ${organizations.length} organization(s)`,
    );

    for (const organization of organizations) {
      let plan;
      try {
        plan = await subscriptionsService.getActivePlan(
          (organization._id as { toString(): string }).toString(),
        );
      } catch {
        // No subscription resolvable for this organization — do not guess a plan for it.
        skippedNoSubscription++;
        console.log(
          `  SKIP  ${organization.id} "${organization.name}" — no resolvable subscription`,
        );
        continue;
      }

      if (!plan.modules.includes('website')) {
        skippedPlanExcludesWebsite++;
        console.log(
          `  SKIP  ${organization.id} "${organization.name}" — plan "${plan.key}" does not grant "website"`,
        );
        continue;
      }

      if (organization.enabledModules.includes('website')) {
        unchanged++;
        continue;
      }

      const next = [...organization.enabledModules, 'website'] as typeof organization.enabledModules;

      wouldChange++;
      console.log(
        `  ${apply ? 'UPDATE' : 'WOULD UPDATE'} ${organization.id} "${organization.name}" ` +
          `(plan: ${plan.key}) enabledModules: [${organization.enabledModules.join(', ')}] -> [${next.join(', ')}]`,
      );

      if (apply) {
        organization.enabledModules = next;
        await organization.save();
        changed++;
      }
    }

    console.log('---');
    console.log(`Total organizations:              ${organizations.length}`);
    console.log(`Skipped (no subscription):        ${skippedNoSubscription}`);
    console.log(`Skipped (plan excludes website):  ${skippedPlanExcludesWebsite}`);
    console.log(`Already consistent:               ${unchanged}`);
    console.log(
      apply
        ? `Updated:                          ${changed}`
        : `Would be updated:                 ${wouldChange} (dry run — pass --apply to write)`,
    );
  } finally {
    await app.close();
  }
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
