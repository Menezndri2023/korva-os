/**
 * Stage 2.8 — operational observability for GAP A (see Stage 2.5): lists
 * `IntegrationWebhookEvent` documents that were cryptographically valid but whose tenant could
 * not be resolved (`organizationId: null` — see that field's own doc comment on
 * integration-webhook-event.schema.ts for why this is an explicit, queryable fail-closed state,
 * not a bug). These events are already fully visible directly in Mongo (`organizationId: null`
 * is an ordinary, indexed field) — this script exists only to make them practically discoverable
 * without a raw shell into the database.
 *
 * Deliberately NOT an HTTP endpoint. This codebase has no cross-tenant "platform operator"
 * authorization concept at all (every Role in packages/types/src/rbac.ts is scoped to exactly
 * one organization; `TenantGuard` is a global guard that requires a real, verified membership on
 * every non-@Public()/@SkipTenant() route; the only 4 existing @SkipTenant() routes — organizations
 * "list mine", auth, 2FA, subscriptions — are all still scoped to the AUTHENTICATED USER's own
 * account, never cross-tenant). Building an HTTP route here would mean inventing a brand-new
 * authorization architecture with no existing precedent to build on safely — see the Stage 2.8
 * final report for the full audit. This follows the exact same, already-established pattern as
 * scripts/create-platform-integration-account.ts and scripts/backfill-enabled-modules.ts instead:
 * direct server/deploy access via `NestFactory.createApplicationContext` IS the authorization
 * boundary, for the same "no request body/route for a client to touch" reasoning.
 *
 * Never prints the raw `payload` field (the provider's own webhook body) — only the fields
 * IntegrationWebhookRepository.findUnresolvedEvents' own UnresolvedWebhookEventSummary type
 * declares. An operator who genuinely needs the raw payload for a specific event must go read
 * that one document directly in Mongo, under whatever access control that requires — this script
 * is a discovery/triage tool, not a payload viewer.
 *
 * Usage:
 *   pnpm --filter @korva/api exec ts-node -r ./scripts/support/ts-extension-resolver.cjs -r tsconfig-paths/register scripts/list-unresolved-webhook-events.ts \
 *     [--page 1] [--limit 20] [--provider flutterwave] [--domain payment]
 *
 * All flags optional. --limit is capped at 100 (mirrors this codebase's own
 * listInvoicesQuerySchema convention — see packages/validation/src/finance.ts) to guard against
 * an operator accidentally requesting an unbounded page.
 */
import { NestFactory } from '@nestjs/core';

// Set BEFORE the application context is built: every scheduler and queue worker checks
// this in its own onModuleInit, so without it this script would start 26 BullMQ blocking
// loops, register repeatable job definitions in Redis, and briefly run real background
// work — a dry-run print could trigger a payment-reconciliation sweep. See
// src/core/background/background-workers.ts.
process.env.DISABLE_BACKGROUND_WORKERS = 'true';
import { AppModule } from '../src/app.module';
import { IntegrationWebhookRepository } from '../src/integrations/webhooks/integration-webhook.repository';
import type { IntegrationWebhookEventDomain } from '../src/integrations/webhooks/schemas/integration-webhook-event.schema';

interface ParsedArgs {
  page: number;
  limit: number;
  provider?: string;
  domain?: IntegrationWebhookEventDomain;
}

function parseArgs(argv: string[]): ParsedArgs {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };

  const page = Number(get('--page') ?? '1');
  const limit = Math.min(Number(get('--limit') ?? '20'), 100);
  if (!Number.isInteger(page) || page < 1) {
    throw new Error(
      `--page must be a positive integer (got: ${get('--page')})`,
    );
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(
      `--limit must be a positive integer (got: ${get('--limit')})`,
    );
  }

  const domain = get('--domain');
  if (domain !== undefined && domain !== 'payment' && domain !== 'messaging') {
    throw new Error(
      `--domain must be "payment" or "messaging" (got: ${domain})`,
    );
  }

  return { page, limit, provider: get('--provider'), domain };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const repository = app.get(IntegrationWebhookRepository);
    const result = await repository.findUnresolvedEvents(args);

    console.log(
      `Unresolved webhook events (organizationId: null) — page ${result.page}/${Math.max(1, Math.ceil(result.total / result.limit))}, ${result.total} total`,
    );
    if (args.provider) console.log(`  filter: provider=${args.provider}`);
    if (args.domain) console.log(`  filter: domain=${args.domain}`);
    console.log('');
    console.log(JSON.stringify(result.data, null, 2));

    if (result.data.length === 0) {
      console.log('\n(no unresolved events on this page)');
    }
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
