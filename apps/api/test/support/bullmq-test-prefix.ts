/**
 * WAVE 3 / E2E-INFRA-5 — transparent per-process BullMQ `prefix` injection for
 * the e2e suite, wired in purely via `jest-e2e.json`'s `moduleNameMapper`
 * (see that file) so that every `import { Queue, Worker, QueueEvents } from
 * 'bullmq'` anywhere in the module graph — including the business-domain
 * files this wave is forbidden from editing (EventBusService,
 * EventsProcessor, QueueMetricsService, QueueAlertingService,
 * ReconciliationSchedulerService, InvoiceOverdueSchedulerService,
 * QuoteExpirySchedulerService, SubscriptionPeriodSchedulerService) — resolves
 * to this file instead of the real package during e2e test runs only.
 *
 * This is the missing piece the prior investigation (see `env.setup.ts`'s
 * `TEST_RUN_REDIS_DB` comment) flagged as requiring source edits: BullMQ's
 * own `prefix` option gives unbounded, collision-proof isolation between
 * concurrent e2e processes sharing the same Redis DB index (proven in
 * `redis-isolation.e2e-spec.ts`), but no business-domain constructor reads a
 * prefix-shaped env var, and adding one to each constructor call was ruled
 * out of scope ("ne modifier aucun domaine métier"). Intercepting the
 * `bullmq` module itself at Jest's module-resolution layer reaches the exact
 * same `new Queue(...)`/`new Worker(...)`/`new QueueEvents(...)` call sites
 * without touching a single line under `apps/api/src/**`.
 *
 * Only `Queue`, `Worker`, and `QueueEvents` are wrapped — confirmed by
 * `grep -rn "from 'bullmq'" apps/api/src` to be the complete set of runtime
 * bullmq imports anywhere in the source tree (no `Job`, `QueueScheduler`,
 * etc. imported anywhere), so there is nothing else this module needs to
 * re-export.
 *
 * Each wrapped constructor injects `prefix: TEST_RUN_BULLMQ_PREFIX` ONLY when
 * the caller didn't already pass one explicitly — every real call site in
 * `apps/api/src/**` omits `prefix` today, so in practice this always applies,
 * but a caller that does pass one (e.g. a future source change, or a test
 * probe) is left alone rather than silently overridden.
 */
import { createRequire } from 'node:module';
import * as path from 'node:path';
import type {
  QueueOptions,
  WorkerOptions,
  QueueEventsOptions,
  Processor,
} from 'bullmq';

// A plain `import ... from 'bullmq'` here would itself be caught by the very
// `moduleNameMapper` rule that routes every OTHER file's `bullmq` import to
// this file — resolving right back to this module and producing `undefined`
// base classes (`Class extends value undefined is not a constructor`).
// `jest.requireActual('bullmq')` does NOT help either: it only skips
// `jest.mock()` manual-mock substitution, not `moduleNameMapper`, which is
// applied one layer down in Jest's resolver — `requireActual('bullmq')`
// still resolves back to this file, confirmed while building this.
//
// What works: never ask any resolver — Jest's or Node's — for the bare
// string `"bullmq"` at all. `require.resolve('bullmq/package.json')` is a
// different specifier that doesn't match the `^bullmq$` regex, so it
// resolves untouched to the real package on disk; reading its `main` field
// gives an absolute path to bullmq's real entry file, which is then loaded
// through `createRequire`'s own require function (never the bare `bullmq`
// specifier, so `moduleNameMapper` has nothing to match) rather than the
// ambient `require` this file's own module wrapper would otherwise use.
const nodeRequire = createRequire(__filename);
const bullmqPackageJsonPath = nodeRequire.resolve('bullmq/package.json');
const bullmqPackageJson = nodeRequire(bullmqPackageJsonPath) as {
  main: string;
};
const bullmqEntryPath = path.join(
  path.dirname(bullmqPackageJsonPath),
  bullmqPackageJson.main,
);
const {
  Queue: RealQueue,
  Worker: RealWorker,
  QueueEvents: RealQueueEvents,
} = nodeRequire(bullmqEntryPath) as typeof import('bullmq');

/**
 * Computed once per OS process by `env.setup.ts` (same `??=`-guarded pattern
 * as `TEST_RUN_DB_NAME`/`TEST_RUN_REDIS_DB`) and read fresh on every
 * construction here — never cached at this module's load time — so a test
 * that deliberately manipulates `process.env.TEST_RUN_BULLMQ_PREFIX` around a
 * specific `new Queue(...)` call (see `redis-isolation.e2e-spec.ts`) can
 * simulate what a second, differently-prefixed process would produce without
 * requiring an actual second OS process.
 */
function currentPrefix(): string {
  return process.env.TEST_RUN_BULLMQ_PREFIX ?? 'e2e_default';
}

export class Queue<
  DataType = unknown,
  ResultType = unknown,
  NameType extends string = string,
> extends RealQueue<DataType, ResultType, NameType> {
  constructor(name: string, opts?: QueueOptions) {
    // `opts` is optional here purely to mirror bullmq's own real constructor
    // signature (every actual call site in `apps/api/src/**` always passes a
    // `connection`); the cast below is required because spreading a
    // possibly-undefined `opts` widens `connection` to optional, which
    // `QueueOptions` (correctly) does not allow.
    super(name, {
      ...opts,
      prefix: opts?.prefix ?? currentPrefix(),
    } as QueueOptions);
  }
}

export class Worker<
  DataType = unknown,
  ResultType = unknown,
  NameType extends string = string,
> extends RealWorker<DataType, ResultType, NameType> {
  constructor(
    name: string,
    processor?: string | URL | null | Processor<DataType, ResultType, NameType>,
    opts?: WorkerOptions,
  ) {
    super(name, processor, {
      ...opts,
      prefix: opts?.prefix ?? currentPrefix(),
    } as WorkerOptions);
  }
}

export class QueueEvents extends RealQueueEvents {
  constructor(name: string, opts?: QueueEventsOptions) {
    super(name, {
      ...opts,
      prefix: opts?.prefix ?? currentPrefix(),
    } as QueueEventsOptions);
  }
}
