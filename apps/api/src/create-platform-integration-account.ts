/**
 * Creates a `platform`-scope IntegrationAccount — KORVA's own credential for a payment or
 * messaging provider (e.g. the Flutterwave secret key backing Flow B / Merchant-of-Record).
 *
 * LIVES UNDER `src/`, NOT `scripts/`, for the same decisive reason as migrate.ts: `nest build`
 * compiles it to `dist/create-platform-integration-account.js`, so it ships inside the
 * production image and runs with plain `node`. It was in `scripts/` until 2026-10-18, which made
 * it impossible to execute against production — the image contains only `dist/`, `packages/` and
 * production `node_modules`, so neither the script nor `ts-node` (a devDependency, dropped by
 * `pnpm install --prod`) was there at all. migrate.ts had already hit and documented exactly
 * this, and named this file while doing so; running the documented command simply failed.
 *
 * Nor could it be run from a laptop instead: the Atlas IP access list holds the VPS address
 * alone (`13.140.174.3/32`), so a workstation cannot reach the production database at all.
 * Shipping it in the image is the only path that works.
 *
 * Deliberately NOT an HTTP endpoint. `IntegrationsController` only ever creates `tenant`-scope
 * accounts, and its request DTOs (`connectPaymentPayoutSchema`/`connectMessagingAccountSchema`,
 * see packages/validation/src/integrations.ts) have no `scope` field at all — a normal tenant
 * has no way to request a platform account through the API, by construction, not by a
 * permission check that could be misconfigured. A platform-wide credential shared across every
 * tenant needs an authorization level this codebase has no existing concept of (every Role is
 * scoped to one organization — see packages/types/src/rbac.ts) — rather than inventing a new
 * cross-tenant "platform operator" role/guard for a single, rare, high-stakes operation, this
 * follows the same pattern as migrate.ts and scripts/manage-plans.ts: direct server/deploy
 * access IS the authorization boundary. There is no request body for a client to smuggle
 * `{"scope":"platform"}` into — the scope is hardcoded to 'platform' below and inside
 * `IntegrationsService.createPlatformAccount` itself.
 *
 * The secret is read from CLI args, never printed back, and never logged — only the resulting
 * account's safe summary (id/domain/provider/role/market/status) is shown.
 *
 * WHICH ACCOUNTS ARE NEEDED, and why at least two (see PaymentProviderResolverService):
 *   - `--role subscription-billing` with NO `--market`: Flow A, KORVA billing its own tenants
 *     for their plans. Market-independent on purpose — Flow A's geography is KORVA's own
 *     incorporation, not the tenant's. Without it, every plan checkout answers
 *     `PAYMENT_PROVIDER_NOT_CONFIGURED`.
 *   - `--role merchant-of-record --market <COUNTRY>`: Flow B, a tenant taking money from its own
 *     customers through its storefront. Resolved by the tenant's `Organization.country`, so this
 *     is ONE ACCOUNT PER COUNTRY you sell in — a tenant in a country with no account cannot be
 *     paid at all.
 *
 * Registered provider keys are `manual`, `flutterwave` and `paystack` (payment-provider.registry.ts).
 * `manual` needs no secret and calls no API; the other two fail closed without one.
 *
 * IN PRODUCTION (dry run first — it writes nothing and validates the flags):
 *   docker compose -f docker-compose.prod.yml --env-file .env.production \
 *     run --rm --no-deps api node dist/create-platform-integration-account.js \
 *     --domain payment --provider flutterwave --role merchant-of-record --market CI \
 *     --secret "<the key>"
 *
 *   ...same flags... --apply                     (writes the account)
 *   ...same flags... --apply --activate          (writes it, then marks it 'active')
 *
 * A non-activated account resolves to `PAYMENT_PROVIDER_NOT_CONFIGURED` just like a missing one
 * — the resolver requires `status === 'active'` — so `--activate` is what actually turns
 * payments on.
 *
 * `run --rm` on the `api` service puts the container on the compose network, so the internal
 * `redis` hostname and the Atlas URI resolve exactly as they do for the running API.
 *
 * In development:
 *   pnpm --filter @korva/api exec ts-node -r ./scripts/support/ts-extension-resolver.cjs \
 *     -r tsconfig-paths/register src/create-platform-integration-account.ts ...
 *
 * Required flags: --domain (payment|messaging), --provider, --role
 * Optional flags: --market, --secret-prompt (preferred: typed without echo, never in the shell
 *   history), --secret (legacy, avoid: visible in history and the process list), --apply,
 *   --activate. With --apply, a payment provider's keys are tested (testConnection) and an
 *   account whose keys fail is NOT activated.
 *
 * GeniusPay (mobile money, see geniuspay-payment.provider.ts) — one account for KORVA's own
 * billing, and ONE merchant-of-record account without --market, which serves every country
 * that has no account of its own (PaymentProviderResolverService):
 *   ... run --rm --no-deps api node dist/create-platform-integration-account.js \
 *     --domain payment --provider geniuspay --role subscription-billing --secret-prompt --apply --activate
 *   ... --domain payment --provider geniuspay --role merchant-of-record \
 *     --secret-prompt --apply --activate
 */
import { NestFactory } from '@nestjs/core';

// Set BEFORE the application context is built: every scheduler and queue worker checks
// this in its own onModuleInit, so without it this script would start 26 BullMQ blocking
// loops, register repeatable job definitions in Redis, and briefly run real background
// work — a dry-run print could trigger a payment-reconciliation sweep. See
// src/core/background/background-workers.ts.
process.env.DISABLE_BACKGROUND_WORKERS = 'true';
import { AppModule } from './app.module';
import { IntegrationsService } from './integrations/integrations.service';
import { IntegrationsRepository } from './integrations/integrations.repository';
import type { IntegrationDomain } from './integrations/integrations.types';
import { PaymentProviderRegistry } from './finance/payments/providers/payment-provider.registry';
import { parseGeniusPayCredential } from './finance/payments/providers/geniuspay-payment.provider';

interface ParsedArgs {
  domain: IntegrationDomain;
  provider: string;
  role: string;
  market: string | null;
  secret: string | null;
  secretPrompt: boolean;
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
    secretPrompt: argv.includes('--secret-prompt'),
    apply: argv.includes('--apply'),
    activate: argv.includes('--activate'),
  };
}

/** Typed without echo on a terminal, or the first line of piped input. Never an argument: a
 *  command line lands in the shell history and the process list. */
function readSecret(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      let data = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (chunk: string | Buffer) => (data += chunk.toString()));
      stdin.on('end', () =>
        resolve(data.split('\n')[0]!.replace(/\r$/, '').trim()),
      );
      stdin.on('error', reject);
      return;
    }
    process.stdout.write(prompt);
    // One * per character: with nothing on screen, people stop and wonder whether typing works.
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (key: string) => {
      for (const char of key) {
        if (char === '\r' || char === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value.trim());
          return;
        }
        if (char === '\u0003') {
          process.stdout.write('\n');
          process.exit(130);
        }
        if (char === '\u007f' || char === '\b') {
          if (value.length > 0) process.stdout.write('\b \b');
          value = value.slice(0, -1);
        } else {
          value += char;
          process.stdout.write('*');
        }
      }
    };
    stdin.on('data', onData);
  });
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.secretPrompt) {
    // Node prints its module warnings on a later tick: let them out BEFORE the question, or they
    // land right after it and the prompt looks like a crash (seen in production, 2026-10-28).
    await new Promise((resolve) => setTimeout(resolve, 200));
    console.log(
      '\nCollez vos clés puis appuyez sur Entrée (une * s’affiche par caractère, jamais la clé).',
    );
    args.secret =
      (await readSecret(
        args.provider === 'geniuspay'
          ? 'Clés GeniusPay (pk_… puis sk_…, séparées par un espace) : '
          : 'Clé secrète : ',
      )) || null;
  }
  // A malformed GeniusPay pair is refused here, before anything is written.
  if (args.provider === 'geniuspay' && args.secret) {
    const { apiKey } = parseGeniusPayCredential(args.secret);
    console.log(
      `Clés reçues : publique + secrète, environnement « ${apiKey.split('_')[1]} ». Vérification…`,
    );
  }

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

    // Prove the keys work before anything is switched on.
    if (
      args.domain === 'payment' &&
      args.secret &&
      args.provider !== 'manual'
    ) {
      const adapter = app
        .get(PaymentProviderRegistry)
        .resolve(args.provider, args.secret);
      const check = (await adapter.testConnection?.()) ?? { ok: true };
      console.log(
        check.ok
          ? `\nConnexion ${args.provider} : OK`
          : `\nConnexion ${args.provider} : ÉCHEC — ${check.message ?? 'refusée'}`,
      );
      if (!check.ok && args.activate) {
        console.log(
          'Compte créé mais NON activé, puisque les clés ne fonctionnent pas.',
        );
        args.activate = false;
      }
    }

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
