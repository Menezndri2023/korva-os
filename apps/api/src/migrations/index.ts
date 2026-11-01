import type { MigrationDefinition } from '../core/migrations/migration.types';
import { migration as m0001 } from './0001-sync-indexes';
import { migration as m0002 } from './0002-plan-currency-index';
import { migration as m0003 } from './0003-plan-catalog-realignment';
import { migration as m0004 } from './0004-marketing-to-starter';
import { migration as m0005 } from './0005-business-model-backfill';
import { migration as m0006 } from './0006-plan-limits-v3';
import { migration as m0007 } from './0007-create-new-indexes';
import { migration as m0008 } from './0008-platform-review-indexes';
import { migration as m0009 } from './0009-ai-usage-platform-index';
import { migration as m0010 } from './0010-korva-ai-all-plans';
import { migration as m0011 } from './0011-korva-ai-quotas-v2';
import { migration as m0012 } from './0012-solde-korva-indexes';
import { migration as m0013 } from './0013-platform-notes-index';

/**
 * Every migration, registered explicitly.
 *
 * Deliberately a static list rather than a `readdirSync` of this directory. Scanning looked
 * tidier and was worse in three ways: it needed to accept both `.ts` and `.js` because the same
 * runner executes from `src/` under ts-node and from `dist/` in the production image, it had to
 * de-duplicate a stale compiled artifact sitting beside its source, and it used `require()`,
 * which this codebase's lint rules forbid. Static imports also mean the compiler proves every
 * entry exists — a renamed file is a build error rather than a migration that silently stops
 * being applied.
 *
 * ADDING ONE: create the file, then add it here. Order in this array is irrelevant — the runner
 * sorts by each migration's own `name`, which is what gets recorded.
 */
export const MIGRATIONS: MigrationDefinition[] = [
  m0001,
  m0002,
  m0003,
  m0004,
  m0005,
  m0006,
  m0007,
  m0008,
  m0009,
  m0010,
  m0011,
  m0012,
  m0013,
];
