/**
 * Stage 2.8 — operational observability for GAP B (see Stage 2.6/2.7A/2.7B): lists `Refund`
 * documents stuck in `status: 'processing'` — the intentional, fail-closed state a refund is left
 * in when Flutterwave returns an ambiguous outcome (a network timeout with no HTTP response ever
 * received; see PaymentsService.refund's own `isAmbiguousProviderError` handling). This is NOT a
 * claim that the provider succeeded or failed — it only means KORVA's own local record is
 * unresolved and needs a human to investigate (e.g. by checking the Flutterwave dashboard
 * directly for the `providerReference` this script prints). Automatic reconciliation was
 * deliberately NOT implemented — see docs/decisions or the Stage 2.7A/2.7B/2.8 final reports for
 * why: no sandbox credential is available, and Flutterwave's own refund status vocabulary was
 * found (via official documentation) to include values like `"completed-mpgs"` that don't match
 * the documented filter enum (`successful`/`failed`/`completed`) — building auto-finalization
 * logic on that would mean inventing an interpretation the documentation doesn't actually confirm.
 *
 * Deliberately NOT an HTTP endpoint — same reasoning as
 * scripts/list-unresolved-webhook-events.ts's own doc comment (no cross-tenant "platform
 * operator" authorization concept exists anywhere in this codebase); this follows the identical,
 * already-established `NestFactory.createApplicationContext` pattern.
 *
 * Never prints the raw Idempotency-Key (only whether one is present) — see
 * PaymentsRepository.findRefundsRequiringAttention's own RefundRequiringAttentionSummary type for
 * exactly what is and isn't exposed, and why.
 *
 * Usage:
 *   pnpm --filter @korva/api exec ts-node -r ./scripts/support/ts-extension-resolver.cjs -r tsconfig-paths/register scripts/list-refunds-requiring-attention.ts \
 *     [--page 1] [--limit 20] [--organization-id <id>]
 *
 * All flags optional. --organization-id restricts the listing to one tenant (an operator-only
 * capability by construction — this script has no HTTP surface a tenant could ever reach).
 * --limit is capped at 100, mirroring this codebase's own pagination convention.
 */
import { NestFactory } from '@nestjs/core';
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
    const result = await repository.findRefundsRequiringAttention(args);

    console.log(
      `Refunds requiring attention (status: processing) — page ${result.page}/${Math.max(1, Math.ceil(result.total / result.limit))}, ${result.total} total`,
    );
    if (args.organizationId) {
      console.log(`  filter: organizationId=${args.organizationId}`);
    }
    console.log(
      '\nIMPORTANT: "processing" means the local outcome is UNRESOLVED — this does NOT mean',
    );
    console.log(
      '  the provider refund succeeded or failed. Investigate manually before taking any action.',
    );
    console.log('');
    console.log(JSON.stringify(result.data, null, 2));

    if (result.data.length === 0) {
      console.log('\n(no refunds requiring attention on this page)');
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
