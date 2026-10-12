/**
 * Creates or updates a row in the shared subscription Plan catalog (the four plans returned by
 * `GET /plans` and offered on every organization's "change plan" screen).
 *
 * Deliberately NOT an HTTP endpoint. `GET /plans` (SubscriptionsController) is the only route
 * touching Plan today, and it's `@SkipTenant()` — there is no cross-tenant "platform operator"
 * role/guard in this codebase's RBAC model (every Role is scoped to one organization, see
 * packages/types/src/rbac.ts) to gate a write endpoint that would let one org's actions change
 * what EVERY organization on the platform can subscribe to. Rather than inventing that new
 * authorization concept for a single, rare, high-stakes operation, this follows the same
 * pattern already established by create-platform-integration-account.ts and
 * backfill-enabled-modules.ts: direct server/deploy access via
 * `NestFactory.createApplicationContext` IS the authorization boundary.
 *
 * Scope, deliberately narrow: create a new plan, or update an existing one's name/price/
 * modules/limits. There is no delete/deactivate — Plan has no such field today (see
 * plan.schema.ts), and removing a plan an organization is actively subscribed to has no defined
 * behavior in SubscriptionsService; adding a real deactivation concept is a separate, real
 * product decision, not something to bolt onto this script.
 *
 * NOTE on the `-r ./scripts/support/ts-extension-resolver.cjs` flag below: it is REQUIRED, not
 * optional polish. Without it every script in this directory dies on
 * `Cannot find module './rbac.js'` before reaching its first line — see that file's own comment
 * for why. The commands documented here were wrong until 2026-10-12.
 *
 * Usage:
 *   pnpm --filter @korva/api exec ts-node -r ./scripts/support/ts-extension-resolver.cjs -r tsconfig-paths/register scripts/manage-plans.ts \
 *     --key starter --name Starter --price 29 --currency EUR --interval month \
 *     --modules crm,catalog,booking,commerce,finance,communication,analytics \
 *     --limits seats=10,ai_messages_per_month=100                                   (dry run, default)
 *
 *   ...same flags... --apply                                                        (writes it)
 *
 * Required flags: --key
 * Required for a NEW plan (the script fails closed rather than guessing): --name, --price,
 * --currency, --interval, --modules
 * Optional: --limits (comma-separated key=value pairs; omit for an empty limits object on
 * create, or to leave existing limits untouched on update), --apply
 */
import { NestFactory } from '@nestjs/core';
import { KORVA_MODULES, PLAN_INTERVALS } from '@korva/types';
import type { KorvaModule, PlanInterval } from '@korva/types';
import { AppModule } from '../src/app.module';
import { PlansRepository } from '../src/subscriptions/plans.repository';

interface ParsedArgs {
  key: string;
  name: string | null;
  price: number | null;
  currency: string | null;
  interval: PlanInterval | null;
  modules: KorvaModule[] | null;
  limits: Record<string, number> | null;
  apply: boolean;
}

function parseModules(raw: string): KorvaModule[] {
  const modules = raw.split(',').map((m) => m.trim());
  for (const module of modules) {
    if (!(KORVA_MODULES as readonly string[]).includes(module)) {
      throw new Error(
        `Unknown module "${module}" — must be one of: ${KORVA_MODULES.join(', ')}`,
      );
    }
  }
  return modules as KorvaModule[];
}

function parseLimits(raw: string): Record<string, number> {
  const limits: Record<string, number> = {};
  for (const pair of raw.split(',')) {
    const [name, value] = pair.split('=');
    if (!name || value === undefined || Number.isNaN(Number(value))) {
      throw new Error(
        `Invalid --limits entry "${pair}" — expected "name=number" (use -1 for unlimited)`,
      );
    }
    limits[name.trim()] = Number(value);
  }
  return limits;
}

function parseArgs(argv: string[]): ParsedArgs {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };

  const key = get('--key');
  if (!key) throw new Error('--key is required');

  const interval = get('--interval');
  if (interval !== undefined && !(PLAN_INTERVALS as readonly string[]).includes(interval)) {
    throw new Error(`--interval must be one of: ${PLAN_INTERVALS.join(', ')}`);
  }
  const price = get('--price');
  const modules = get('--modules');
  const limits = get('--limits');

  return {
    key,
    name: get('--name') ?? null,
    price: price !== undefined ? Number(price) : null,
    currency: get('--currency') ?? null,
    interval: (interval as PlanInterval | undefined) ?? null,
    modules: modules ? parseModules(modules) : null,
    limits: limits ? parseLimits(limits) : null,
    apply: argv.includes('--apply'),
  };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    // --currency is now part of a plan's IDENTITY, not just a field on it: a tier is one
    // document per currency (see plan.schema.ts's compound unique index), so "--key starter"
    // alone no longer names a single plan. Required for every operation, not only creation.
    if (!args.currency) {
      throw new Error(
        '--currency is required: a plan is identified by (key, currency), so "--key starter" alone is ambiguous',
      );
    }
    const currency = args.currency;

    const plansRepository = app.get(PlansRepository);
    const existing = await plansRepository.findByKeyAndCurrency(
      args.key,
      currency,
    );

    console.log(
      `${args.apply ? 'APPLY' : 'DRY RUN'} — plan "${args.key}" in ${currency}`,
    );
    console.log(`  mode: ${existing ? 'UPDATE existing plan' : 'CREATE new plan'}`);

    if (!existing) {
      if (
        !args.name ||
        args.price === null ||
        !args.currency ||
        !args.interval ||
        !args.modules
      ) {
        throw new Error(
          'Creating a new plan requires --name, --price, --currency, --interval, and --modules',
        );
      }
    }

    const fields = {
      ...(args.name ? { name: args.name } : {}),
      ...(args.price !== null ? { priceAmount: args.price } : {}),
      ...(args.currency ? { priceCurrency: args.currency } : {}),
      ...(args.interval ? { interval: args.interval } : {}),
      ...(args.modules ? { modules: args.modules } : {}),
      ...(args.limits ? { limits: args.limits } : {}),
    };
    console.log('  fields:', JSON.stringify(fields, null, 2));

    if (!args.apply) {
      console.log('\nDry run only — nothing written. Pass --apply to write this plan.');
      return;
    }

    const result = existing
      ? await plansRepository.updateByKeyAndCurrency(args.key, currency, fields)
      : await plansRepository.create({
          key: args.key,
          name: args.name!,
          priceAmount: args.price!,
          priceCurrency: args.currency!,
          interval: args.interval!,
          modules: args.modules!,
          limits: args.limits ?? {},
        });

    console.log(`\n${existing ? 'Updated' : 'Created'} plan:`);
    console.log(JSON.stringify(result, null, 2));
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
