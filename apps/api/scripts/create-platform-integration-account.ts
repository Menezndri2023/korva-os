/**
 * Creates a `platform`-scope IntegrationAccount — KORVA's own credential for a payment or
 * messaging provider (e.g. the Flutterwave secret key backing Flow B / Merchant-of-Record).
 *
 * Deliberately NOT an HTTP endpoint. `IntegrationsController` only ever creates `tenant`-scope
 * accounts, and its request DTOs (`connectPaymentPayoutSchema`/`connectMessagingAccountSchema`,
 * see packages/validation/src/integrations.ts) have no `scope` field at all — a normal tenant
 * has no way to request a platform account through the API, by construction, not by a
 * permission check that could be misconfigured. A platform-wide credential shared across every
 * tenant needs an authorization level this codebase has no existing concept of (every Role is
 * scoped to one organization — see packages/types/src/rbac.ts) — rather than inventing a new
 * cross-tenant "platform operator" role/guard for a single, rare, high-stakes operation, this
 * follows the same pattern already established by scripts/backfill-enabled-modules.ts: direct
 * server/deploy access via `NestFactory.createApplicationContext` IS the authorization boundary.
 * There is no request body for a client to smuggle `{"scope":"platform"}` into — the scope is
 * hardcoded to 'platform' below and inside `IntegrationsService.createPlatformAccount` itself.
 *
 * The secret is read from CLI args, never printed back, and never logged — only the resulting
 * account's safe summary (id/domain/provider/role/market/status) is shown.
 *
 * Usage:
 *   pnpm --filter @korva/api exec ts-node -r ./scripts/support/ts-extension-resolver.cjs -r tsconfig-paths/register scripts/create-platform-integration-account.ts \
 *     --domain payment --provider flutterwave --role merchant-of-record --market CI \
 *     --secret "$FLUTTERWAVE_SECRET_KEY"                                                  (dry run, default — validates and prints, writes nothing)
 *
 *   ...same flags... --apply                                                              (writes the account)
 *   ...same flags... --apply --activate                                                   (writes the account, then marks it 'active')
 *
 * Required flags: --domain (payment|messaging), --provider, --role
 * Optional flags: --market, --secret, --apply, --activate
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntegrationsService } from '../src/integrations/integrations.service';
import { IntegrationsRepository } from '../src/integrations/integrations.repository';
import type { IntegrationDomain } from '../src/integrations/integrations.types';

interface ParsedArgs {
  domain: IntegrationDomain;
  provider: string;
  role: string;
  market: string | null;
  secret: string | null;
  apply: boolean;
  activate: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };

  const domain = get('--domain');
  if (domain !== 'payment' && domain !== 'messaging') {
    throw new Error(
      `--domain is required and must be "payment" or "messaging" (got: ${domain ?? '<missing>'})`,
    );
  }
  const provider = get('--provider');
  if (!provider) throw new Error('--provider is required');
  const role = get('--role');
  if (!role) throw new Error('--role is required');

  return {
    domain,
    provider,
    role,
    market: get('--market') ?? null,
    secret: get('--secret') ?? null,
    apply: argv.includes('--apply'),
    activate: argv.includes('--activate'),
  };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  console.log(
    `${args.apply ? 'APPLY' : 'DRY RUN'} — platform IntegrationAccount`,
  );
  console.log(
    `  scope:    platform (hardcoded — not a CLI flag, not client-controllable)`,
  );
  console.log(`  domain:   ${args.domain}`);
  console.log(`  provider: ${args.provider}`);
  console.log(`  role:     ${args.role}`);
  console.log(`  market:   ${args.market ?? '(none — market-independent)'}`);
  console.log(
    `  secret:   ${args.secret ? '<redacted, ' + args.secret.length + ' chars>' : '(none provided)'}`,
  );
  console.log(`  activate: ${args.activate}`);

  if (!args.apply) {
    console.log(
      '\nDry run only — nothing written. Pass --apply to create this account.',
    );
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const integrationsService = app.get(IntegrationsService);

    const created = await integrationsService.createPlatformAccount({
      domain: args.domain,
      provider: args.provider,
      role: args.role,
      market: args.market,
      secret: args.secret,
    });

    if (args.activate) {
      const integrationsRepository = app.get(IntegrationsRepository);
      await integrationsRepository.updateStatus(created.id, 'active');
    }

    console.log('\nCreated platform IntegrationAccount:');
    console.log(
      JSON.stringify(
        {
          id: created.id,
          scope: created.scope,
          domain: created.domain,
          provider: created.provider,
          role: created.role,
          market: created.market,
          status: args.activate ? 'active' : created.status,
        },
        null,
        2,
      ),
    );
    console.log(
      '\n(secret is encrypted at rest and was never printed above — this output is safe to paste into a ticket/log)',
    );
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
