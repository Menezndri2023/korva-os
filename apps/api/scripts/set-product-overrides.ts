/**
 * Grants or revokes a KORVA product for one organization, beyond what its plan includes — the
 * operator-side add-on path.
 *
 * Why a script and not an endpoint: `PATCH /subscriptions/product-overrides` exists and is
 * gated on `settings.manage`, but as of 2026-10-12 it only lets a tenant set an override its
 * plan ALREADY covers (see SubscriptionsService#assertOverridesWithinPlan). Granting a product
 * the plan does not include is a commercial act with no price attached anywhere in the model,
 * so it must not be self-service. This codebase has no cross-tenant operator role to gate such
 * an endpoint with — every Role is scoped to one organization (packages/types/src/rbac.ts) — so
 * direct server/deploy access IS the authorization boundary, exactly as for manage-plans.ts and
 * create-platform-integration-account.ts.
 *
 * Writes the override directly through the repository, bypassing the service's
 * within-plan check on purpose. It still re-synchronizes the organization's enabledModules the
 * same way the service does, because an override that is not reflected there grants nothing:
 * ModuleGuard enforces enabledModules per request, not the override map.
 *
 * Usage:
 *   pnpm --filter @korva/api exec ts-node -r ./scripts/support/ts-extension-resolver.cjs -r tsconfig-paths/register \
 *     scripts/set-product-overrides.ts --organization <id> --grant ai                      (dry run, default)
 *
 *   ...same flags... --apply                                                               (writes it)
 *
 * Required: --organization. At least one of --grant / --revoke (comma-separated product keys).
 * Products: crm, inventory, website, ai.
 */
import { NestFactory } from '@nestjs/core';

// Set BEFORE the application context is built: every scheduler and queue worker checks
// this in its own onModuleInit, so without it this script would start 26 BullMQ blocking
// loops, register repeatable job definitions in Redis, and briefly run real background
// work — a dry-run print could trigger a payment-reconciliation sweep. See
// src/core/background/background-workers.ts.
process.env.DISABLE_BACKGROUND_WORKERS = 'true';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { KORVA_PRODUCTS, resolveEffectiveModules } from '@korva/types';
import type { KorvaProduct } from '@korva/types';
import { AppModule } from '../src/app.module';
import { SubscriptionsRepository } from '../src/subscriptions/subscriptions.repository';
import { PlansService } from '../src/subscriptions/plans.service';
import {
  Organization,
  OrganizationDocument,
} from '../src/organizations/schemas/organization.schema';

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function parseProducts(raw: string | undefined, label: string): KorvaProduct[] {
  if (!raw) return [];
  return raw.split(',').map((part) => {
    const product = part.trim();
    if (!(KORVA_PRODUCTS as readonly string[]).includes(product)) {
      throw new Error(
        `${label}: unknown product "${product}" (expected one of ${KORVA_PRODUCTS.join(', ')})`,
      );
    }
    return product as KorvaProduct;
  });
}

async function run() {
  const organizationId = flag('--organization');
  if (!organizationId) throw new Error('--organization is required');
  const grant = parseProducts(flag('--grant'), '--grant');
  const revoke = parseProducts(flag('--revoke'), '--revoke');
  if (grant.length === 0 && revoke.length === 0) {
    throw new Error('Pass at least one of --grant or --revoke');
  }
  const overlap = grant.filter((p) => revoke.includes(p));
  if (overlap.length > 0) {
    // Granting and revoking the same product in one call has no defined winner — refuse rather
    // than let argument order decide a commercial outcome.
    throw new Error(`Cannot both grant and revoke: ${overlap.join(', ')}`);
  }
  const apply = process.argv.includes('--apply');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const subscriptionsRepository = app.get(SubscriptionsRepository);
    const plansService = app.get(PlansService);
    const organizationModel = app.get<Model<OrganizationDocument>>(
      getModelToken(Organization.name),
    );

    const subscription =
      await subscriptionsRepository.findForOrganization(organizationId);
    if (!subscription) {
      throw new Error(`No subscription found for organization ${organizationId}`);
    }
    const plan = await plansService.getById(subscription.planId.toString());

    // Merged onto the existing map, not replacing it: the HTTP route replaces wholesale, but an
    // operator granting one add-on must not silently clear another already in place.
    const productOverrides = { ...(subscription.productOverrides ?? {}) };
    for (const product of grant) productOverrides[product] = true;
    for (const product of revoke) productOverrides[product] = false;

    const effectiveModules = resolveEffectiveModules(
      plan.modules,
      productOverrides,
    );

    console.log(`${apply ? 'APPLY' : 'DRY RUN'} — organization ${organizationId}`);
    console.log(`  plan: ${plan.key} (${plan.priceCurrency})`);
    console.log(`  overrides: ${JSON.stringify(productOverrides)}`);
    console.log(`  effective modules: ${effectiveModules.join(', ')}`);

    if (!apply) {
      console.log('\nDry run — nothing written. Re-run with --apply.');
      return;
    }

    await subscriptionsRepository.update(organizationId, { productOverrides });

    const organization = await organizationModel.findById(organizationId).exec();
    if (organization) {
      const before = [...organization.enabledModules];
      // Grants are additive here (an add-on the operator just paid for should be usable without
      // a second trip to Settings); revocations strip, matching the service's own behavior.
      const next = new Set(
        before.filter((module) => effectiveModules.includes(module)),
      );
      for (const product of grant) {
        for (const module of resolveEffectiveModules([], { [product]: true })) {
          if (effectiveModules.includes(module)) next.add(module);
        }
      }
      organization.enabledModules = Array.from(next);
      await organization.save();
      console.log(`  enabledModules: ${organization.enabledModules.join(', ')}`);
    }
    console.log('\nDone.');
  } finally {
    await app.close();
  }
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
