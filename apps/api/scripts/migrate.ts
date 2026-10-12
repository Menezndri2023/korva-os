/**
 * Applies pending migrations from `apps/api/migrations/`, in lexicographic order of each
 * migration's own `name`, recording each in the `migrations` collection once it completes.
 *
 * Deliberately NOT an HTTP endpoint and deliberately not run automatically at boot:
 *
 *  - Not an endpoint, for the same reason as manage-plans.ts and
 *    create-platform-integration-account.ts — this codebase has no cross-tenant "platform
 *    operator" concept in its RBAC model (every Role is scoped to one organization, see
 *    packages/types/src/rbac.ts), and direct server/deploy access IS the authorization boundary.
 *  - Not at boot, because several API instances boot at once during a rolling deploy. Three of
 *    them racing the same migration is how you get a half-applied data transformation. One
 *    deliberate invocation from the deploy pipeline, before the new instances start, is the
 *    whole point. See docs/deployment.md's runbook.
 *
 * Dry run is the default, matching every other script here:
 *   pnpm --filter @korva/api exec ts-node -r ./scripts/support/ts-extension-resolver.cjs -r tsconfig-paths/register scripts/migrate.ts
 *   pnpm --filter @korva/api exec ts-node -r ./scripts/support/ts-extension-resolver.cjs -r tsconfig-paths/register scripts/migrate.ts --apply
 *
 * Exits non-zero if any migration throws, and stops at the first failure rather than carrying on
 * — a later migration may well depend on an earlier one having completed.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { AppModule } from '../src/app.module';
import {
  Migration,
  MigrationDocument,
} from '../src/core/migrations/schemas/migration.schema';
import type { MigrationDefinition } from '../src/core/migrations/migration.types';

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

/** Loads every `*.ts` in migrations/, sorted by the definition's own `name` rather than by
 *  filename — the name is what gets recorded, so it must be what defines order. */
function loadMigrations(): MigrationDefinition[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .sort();
  const loaded = files.map((file) => {
    const mod = require(join(MIGRATIONS_DIR, file)) as {
      migration?: MigrationDefinition;
      default?: MigrationDefinition;
    };
    const migration = mod.migration ?? mod.default;
    if (!migration?.name || typeof migration.up !== 'function') {
      throw new Error(
        `migrations/${file} does not export a MigrationDefinition (expected a named \`migration\` or a default export)`,
      );
    }
    return migration;
  });
  const names = loaded.map((m) => m.name);
  const duplicate = names.find((n, i) => names.indexOf(n) !== i);
  if (duplicate) {
    // Two migrations sharing a name means the second could never be recorded, and would be
    // silently re-run forever. Fail loudly rather than half-apply.
    throw new Error(`Duplicate migration name: "${duplicate}"`);
  }
  return loaded.sort((a, b) => a.name.localeCompare(b.name));
}

async function run() {
  const apply = process.argv.includes('--apply');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const connection = app.get<Connection>(getConnectionToken());
    const migrationModel = app.get<Model<MigrationDocument>>(
      getModelToken(Migration.name),
    );

    // The `migrations` collection's own unique index is what makes this runner safe to re-run,
    // so it must exist before the first record is written — and it cannot be created by
    // 0001-sync-indexes, which has not run yet on a fresh database.
    await migrationModel.syncIndexes();

    const defined = loadMigrations();
    const appliedNames = new Set(
      (await migrationModel.find().select('name').exec()).map((d) => d.name),
    );
    const pending = defined.filter((m) => !appliedNames.has(m.name));

    console.log(
      `${defined.length} migration(s) defined, ${appliedNames.size} already applied, ${pending.length} pending.`,
    );
    if (pending.length === 0) {
      console.log('Nothing to do.');
      return;
    }
    for (const m of pending) {
      console.log(`  pending: ${m.name}`);
    }

    if (!apply) {
      console.log('\nDry run — nothing was applied. Re-run with --apply.');
      return;
    }

    for (const m of pending) {
      const startedAt = Date.now();
      console.log(`\nApplying ${m.name}...`);
      await m.up(connection);
      const durationMs = Date.now() - startedAt;
      // Recorded only after up() resolves: a crash mid-migration leaves it unrecorded, so the
      // next run starts it again from the beginning. That is why every up() must be re-runnable.
      await migrationModel.create({
        name: m.name,
        appliedAt: new Date(),
        durationMs,
      });
      console.log(`  done in ${durationMs}ms`);
    }
    console.log(`\nApplied ${pending.length} migration(s).`);
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
