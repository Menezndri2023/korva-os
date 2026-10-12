/**
 * Stage 2.10 — operational discovery: lists `Payment` documents in `status: 'pending'` or
 * `status: 'processing'` — the ordinary, expected in-flight state for an asynchronous provider
 * (Flutterwave's `createPayment()` always returns `'pending'` synchronously; real completion
 * only happens later, via a real customer checkout or the periodic reconciliation sweep — see
 * PaymentReconciliationService / PaymentsService.reconcileProcessingPayment). Unlike a stuck
 * `Refund` (Stage 2.8's `list-refunds-requiring-attention.ts`), a row appearing here is NOT
 * inherently anomalous — the overwhelming majority resolve automatically within one sweep
 * interval. This script exists purely so an operator can see the current candidate set on
 * demand, without waiting for or parsing the sweep's own aggregate log line.
 *
 * Deliberately NOT an HTTP endpoint — identical reasoning to
 * scripts/list-unresolved-webhook-events.ts and scripts/list-refunds-requiring-attention.ts
 * (Stage 2.8): this codebase has no cross-tenant "platform operator" authorization concept at
 * all (every Role in packages/types/src/rbac.ts is scoped to exactly one organization;
 * `TenantGuard` is a global guard requiring a real, verified membership on every non-public
 * route). Building an HTTP route here would mean inventing a brand-new authorization
 * architecture with no existing precedent to build on safely. This follows the exact same,
 * already-established pattern as scripts/create-platform-integration-account.ts and the two
 * Stage 2.8 scripts instead: direct server/deploy access via
 * `NestFactory.createApplicationContext` IS the authorization boundary.
 *
 * Never prints a raw Idempotency-Key (only whether one is present) or any provider
 * credential/secret — only the fields PaymentsRepository.findProcessingPaymentsPaginated's own
 * ProcessingPaymentSummary type declares. Makes no provider/network call of any kind.
 *
 * Usage:
 *   pnpm --filter @korva/api exec ts-node -r ./scripts/support/ts-extension-resolver.cjs -r tsconfig-paths/register scripts/list-processing-payments.ts \
 *     [--page 1] [--limit 20] [--organization-id <id>]
 *
 * All flags optional. --organization-id restricts the listing to one tenant (an operator-only
 * capability by construction — this script has no HTTP surface a tenant could ever reach).
 * --limit is capped at 100, mirroring the Stage 2.8 scripts' own pagination convention.
 */
import { NestFactory } from '@nestjs/core';

// Set BEFORE the application context is built: every scheduler and queue worker checks
// this in its own onModuleInit, so without it this script would start 26 BullMQ blocking
// loops, register repeatable job definitions in Redis, and briefly run real background
// work — a dry-run print could trigger a payment-reconciliation sweep. See
// src/core/background/background-workers.ts.
process.env.DISABLE_BACKGROUND_WORKERS = 'true';
import { AppModule } from '../src/app.module';
import { PaymentsRepository } from '../src/finance/payments/payments.repository';

interface ParsedArgs {
  page: number;
  limit: number;
  organizationId?: string;
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

  return { page, limit, organizationId: get('--organization-id') };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const repository = app.get(PaymentsRepository);
    const result = await repository.findProcessingPaymentsPaginated(args);

    console.log(
      `Processing payments (status: pending/processing) — page ${result.page}/${Math.max(1, Math.ceil(result.total / result.limit))}, ${result.total} total`,
    );
    if (args.organizationId) {
      console.log(`  filter: organizationId=${args.organizationId}`);
    }
    console.log(
      '\nNote: "pending"/"processing" is the ordinary in-flight state for an asynchronous',
    );
    console.log(
      '  provider — most of these resolve automatically within one reconciliation sweep.',
    );
    console.log('');
    console.log(JSON.stringify(result.data, null, 2));

    if (result.data.length === 0) {
      console.log('\n(no processing payments on this page)');
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
