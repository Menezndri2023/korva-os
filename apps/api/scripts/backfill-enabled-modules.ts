/**
 * One-time, idempotent backfill for organizations whose enabledModules is empty or contains
 * modules no longer allowed by their current plan — a precondition for ModuleGuard, which
 * treats enabledModules as a real access-control list instead of a UI-only preference.
 *
 * Rule applied per organization:
 *   - enabledModules is empty  -> set to the organization's current plan.modules (nothing was
 *     blocking these orgs before; this preserves what they already had access to, bounded by
 *     what their own plan already allows — never grants anything beyond that).
 *   - enabledModules is non-empty -> intersect with plan.modules (drop only what the current
 *     plan no longer allows; never add a module the organization hadn't already chosen).
 *
 * Idempotent: re-running with no organizations left to fix makes zero writes.
 *
 * Usage:
 *   pnpm --filter @korva/api exec ts-node -r ./scripts/support/ts-extension-resolver.cjs -r tsconfig-paths/register scripts/backfill-enabled-modules.ts            (dry run, default)
 *   pnpm --filter @korva/api exec ts-node -r ./scripts/support/ts-extension-resolver.cjs -r tsconfig-paths/register scripts/backfill-enabled-modules.ts --apply    (writes changes)
 */
import { NestFactory } from '@nestjs/core';

// Set BEFORE the application context is built: every scheduler and queue worker checks
// this in its own onModuleInit, so without it this script would start 26 BullMQ blocking
// loops, register repeatable job definitions in Redis, and briefly run real background
// work — a dry-run print could trigger a payment-reconciliation sweep. See
// src/core/background/background-workers.ts.
process.env.DISABLE_BACKGROUND_WORKERS = 'true';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppModule } from '../src/app.module';
import { Organization, OrganizationDocument } from '../src/organizations/schemas/organization.schema';
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

      const current = organization.enabledModules;
      const next =
        current.length === 0
          ? plan.modules
          : current.filter((module) => plan.modules.includes(module));

      const sameSet =
        current.length === next.length &&
        current.every((module) => next.includes(module));

      if (sameSet) {
        unchanged++;
        continue;
      }

      wouldChange++;
      console.log(
        `  ${apply ? 'UPDATE' : 'WOULD UPDATE'} ${organization.id} "${organization.name}" ` +
          `(plan: ${plan.key}) enabledModules: [${current.join(', ')}] -> [${next.join(', ')}]`,
      );

      if (apply) {
        organization.enabledModules = next;
        await organization.save();
        changed++;
      }
    }

    console.log('---');
    console.log(`Total organizations:        ${organizations.length}`);
    console.log(`Skipped (no subscription):  ${skippedNoSubscription}`);
    console.log(`Already consistent:         ${unchanged}`);
    console.log(
      apply
        ? `Updated:                    ${changed}`
        : `Would be updated:           ${wouldChange} (dry run — pass --apply to write)`,
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
