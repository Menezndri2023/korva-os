import type { Connection } from 'mongoose';

/**
 * A single, named, forward-only data or schema migration.
 *
 * No `down()`, deliberately. A rollback that has to undo a data transformation is usually either
 * impossible (the old value is gone) or a second migration in its own right — offering the hook
 * invites writing one that was never tested and cannot work. Reverting means writing a new
 * forward migration, which at least gets reviewed and recorded like any other.
 *
 * `up()` receives the raw Mongoose `Connection` rather than any service: a migration must keep
 * working after the service it was written against is refactored or deleted, so it talks to
 * collections directly. It MUST be safe to run against a database where it has partially run —
 * the runner records completion only after `up()` resolves, so a crash halfway through means the
 * same migration runs again from the start.
 */
export interface MigrationDefinition {
  /** Stable, unique, and sortable — the runner applies migrations in lexicographic order of
   *  this value, so the numeric prefix is what defines sequence. Never rename an applied one:
   *  the name is the only key tying a row in `migrations` to the code that ran. */
  name: string;
  up(connection: Connection): Promise<void>;
}
