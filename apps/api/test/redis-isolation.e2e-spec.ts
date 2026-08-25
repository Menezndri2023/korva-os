import { spawnSync } from 'node:child_process';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import type { EventJobData } from '../src/core/events/event-names';

/**
 * Proves both halves of the WAVE 2.1 / E2E-INFRA-5 investigation into Redis
 * cross-process isolation for the e2e suite (see `env.setup.ts`'s
 * `TEST_RUN_REDIS_DB` comment and the WAVE 2.1 AGENT G final report):
 *
 *  1. `env.setup.ts` now picks a per-process Redis DB index (1-15, DB 0
 *     reserved for dev) instead of a single hardcoded `db 1` shared by every
 *     concurrent e2e process — a real, if bounded (16 Redis DBs total),
 *     improvement over the prior behavior which guaranteed a collision the
 *     instant two e2e processes ran at once.
 *  2. The ideal fix — BullMQ's native `prefix` option, which would give
 *     unbounded, guaranteed isolation on a SHARED DB index the same way the
 *     Mongo fix gives unbounded isolation via database name — cannot be
 *     wired up from test infrastructure alone (no business-domain file reads
 *     any prefix-shaped env var today), and the tempting zero-code-change
 *     workaround (ioredis's own `keyPrefix`, settable purely via a
 *     `REDIS_URL` query string) is a dead end: BullMQ rejects it outright.
 *     This is documented here as executable proof, not just a claim in a
 *     report, so a future agent picking up the Category 2 cross-agent
 *     dependency (threading `prefix` through
 *     EventBusService/EventsProcessor/QueueMetricsService/
 *     QueueAlertingService/the finance schedulers) has a verified baseline to
 *     build on.
 */
describe('Redis per-process isolation (e2e)', () => {
  it('env.setup.ts derives REDIS_URL with a DB index in the reserved test range (1-15)', () => {
    const url = process.env.REDIS_URL;
    expect(url).toBeDefined();
    const match = url!.match(/^redis:\/\/localhost:6380\/(\d+)$/);
    expect(match).not.toBeNull();
    const dbIndex = Number(match![1]);
    expect(dbIndex).toBeGreaterThanOrEqual(1);
    expect(dbIndex).toBeLessThanOrEqual(15);
  });

  it('independent OS processes loading env.setup.ts pick varying DB indices, not a single shared constant', () => {
    // Faithful proxy for "several concurrent agents/terminals each running
    // their own `npx jest --config test/jest-e2e.json`", exactly like
    // mongo-isolation.e2e-spec.ts's analogous test for MONGODB_URI. A single
    // pair of child processes could in principle land on the same one of 15
    // DB indices by chance (~6.7%) — sampling 30 independent processes and
    // asserting more than one distinct value appears makes this assertion
    // non-flaky (P(all 30 collapse to one value) = (1/15)^29, indistinguishable
    // from zero) while still proving the mechanism is genuinely randomized
    // per-process rather than a hardcoded constant.
    const runOnce = (): number => {
      const result = spawnSync(
        process.execPath,
        [
          '-e',
          "import('./test/env.setup.ts').then(() => console.log(process.env.REDIS_URL))",
          '--input-type=module',
        ],
        { cwd: `${__dirname}/..`, encoding: 'utf-8' },
      );
      const url = result.stdout
        .split('\n')
        .find((line) => line.startsWith('redis://'));
      if (!url) {
        throw new Error(
          `child process produced no REDIS_URL — stdout: ${result.stdout}\nstderr: ${result.stderr}`,
        );
      }
      const match = url.match(/\/(\d+)$/);
      if (!match) {
        throw new Error(`REDIS_URL had no trailing DB index: ${url}`);
      }
      return Number(match[1]);
    };

    const samples = Array.from({ length: 30 }, () => runOnce());
    for (const dbIndex of samples) {
      expect(dbIndex).toBeGreaterThanOrEqual(1);
      expect(dbIndex).toBeLessThanOrEqual(15);
    }
    expect(new Set(samples).size).toBeGreaterThan(1);
  });

  describe('BullMQ isolation mechanisms on a single shared Redis DB', () => {
    const BASE_URL = 'redis://localhost:6380/1';
    const QUEUE_NAME = `redis-isolation-probe-${process.pid}`;
    interface ProbeJobData {
      marker: string;
    }
    const openHandles: Array<{ close: () => unknown }> = [];

    afterEach(async () => {
      await Promise.all(
        openHandles.splice(0).map((h) => Promise.resolve(h.close())),
      );
    });

    it("BullMQ's native `prefix` option gives real cross-process job isolation on the same Redis DB", async () => {
      const connA = new IORedis(BASE_URL, { maxRetriesPerRequest: null });
      const connB = new IORedis(BASE_URL, { maxRetriesPerRequest: null });
      openHandles.push({ close: () => connA.disconnect() });
      openHandles.push({ close: () => connB.disconnect() });

      const queueA = new Queue<ProbeJobData>(QUEUE_NAME, {
        connection: connA,
        prefix: 'proc_a',
      });
      const queueB = new Queue<ProbeJobData>(QUEUE_NAME, {
        connection: connB,
        prefix: 'proc_b',
      });
      openHandles.push({ close: () => queueA.close() });
      openHandles.push({ close: () => queueB.close() });

      const seenByA: string[] = [];
      const seenByB: string[] = [];

      const workerA = new Worker<ProbeJobData>(
        QUEUE_NAME,
        (job) => {
          seenByA.push(job.data.marker);
          return Promise.resolve();
        },
        { connection: connA, prefix: 'proc_a' },
      );
      const workerB = new Worker<ProbeJobData>(
        QUEUE_NAME,
        (job) => {
          seenByB.push(job.data.marker);
          return Promise.resolve();
        },
        { connection: connB, prefix: 'proc_b' },
      );
      openHandles.push({ close: () => workerA.close() });
      openHandles.push({ close: () => workerB.close() });

      await new Promise((resolve) => setTimeout(resolve, 500));

      await queueA.add('job', { marker: 'from-A' });
      await queueB.add('job', { marker: 'from-B' });

      await new Promise((resolve) => setTimeout(resolve, 2000));

      expect(seenByA).toEqual(['from-A']);
      expect(seenByB).toEqual(['from-B']);
    }, 10000);

    it('ioredis-level `keyPrefix` (a REDIS_URL-only, zero-code-change alternative) is rejected outright by BullMQ, confirming it is not a viable path', () => {
      const conn = new IORedis(`${BASE_URL}?keyPrefix=rejected_probe__`, {
        maxRetriesPerRequest: null,
      });
      openHandles.push({ close: () => conn.disconnect() });

      expect(conn.options.keyPrefix).toBe('rejected_probe__');
      expect(() => new Queue(QUEUE_NAME, { connection: conn })).toThrow(
        /does not support ioredis prefixes/,
      );
    });
  });

  /**
   * WAVE 3 / E2E-INFRA-5 — closes the gap the two describe blocks above leave
   * open: BullMQ's `prefix` option is proven to work, but every real
   * `Queue`/`Worker`/`QueueEvents` in this codebase is constructed inside a
   * business-domain file this wave may not edit. `jest-e2e.json`'s
   * `moduleNameMapper` now resolves `bullmq` to
   * `test/support/bullmq-test-prefix.ts` for every file in the module graph
   * — including `apps/api/src/**` — which auto-injects
   * `process.env.TEST_RUN_BULLMQ_PREFIX` into any constructor call that
   * doesn't already pass one. These tests prove that mechanism end-to-end,
   * finishing on the same real, UNEDITED `EventBusService` production file
   * (not a probe/mock queue) to demonstrate this actually reaches business
   * domain code without touching it.
   */
  describe('Transparent per-process prefix injection via jest moduleNameMapper (no business-domain edits)', () => {
    const BASE_URL = 'redis://localhost:6380/1';
    const openHandles: Array<{ close: () => unknown }> = [];
    let originalPrefixEnv: string | undefined;

    beforeEach(() => {
      originalPrefixEnv = process.env.TEST_RUN_BULLMQ_PREFIX;
    });

    afterEach(async () => {
      await Promise.all(
        openHandles.splice(0).map((h) => Promise.resolve(h.close())),
      );
      process.env.TEST_RUN_BULLMQ_PREFIX = originalPrefixEnv;
    });

    it('a Queue constructed with no explicit `prefix` automatically picks up TEST_RUN_BULLMQ_PREFIX', async () => {
      process.env.TEST_RUN_BULLMQ_PREFIX = 'auto_inject_probe';
      const connection = new IORedis(BASE_URL, { maxRetriesPerRequest: null });
      const queue = new Queue<{ marker: string }>(
        `redis-isolation-auto-prefix-${process.pid}`,
        { connection },
      );
      openHandles.push({ close: () => connection.disconnect() });
      openHandles.push({ close: () => queue.close() });

      const job = await queue.add('job', { marker: 'x' });

      expect(job.prefix).toBe('auto_inject_probe');
    });

    it('two auto-injected prefixes (simulating two concurrent e2e OS processes) fully isolate BullMQ job consumption on the same Redis DB and queue name — via automatic injection, not a manually-passed option', async () => {
      const QUEUE_NAME = `redis-isolation-auto-cross-${process.pid}`;
      interface ProbeJobData {
        marker: string;
      }
      const seenByA: string[] = [];
      const seenByB: string[] = [];

      process.env.TEST_RUN_BULLMQ_PREFIX = 'auto_proc_a';
      const connA = new IORedis(BASE_URL, { maxRetriesPerRequest: null });
      const queueA = new Queue<ProbeJobData>(QUEUE_NAME, { connection: connA });
      const workerA = new Worker<ProbeJobData>(
        QUEUE_NAME,
        (job) => {
          seenByA.push(job.data.marker);
          return Promise.resolve();
        },
        { connection: connA },
      );

      process.env.TEST_RUN_BULLMQ_PREFIX = 'auto_proc_b';
      const connB = new IORedis(BASE_URL, { maxRetriesPerRequest: null });
      const queueB = new Queue<ProbeJobData>(QUEUE_NAME, { connection: connB });
      const workerB = new Worker<ProbeJobData>(
        QUEUE_NAME,
        (job) => {
          seenByB.push(job.data.marker);
          return Promise.resolve();
        },
        { connection: connB },
      );

      for (const h of [connA, connB])
        openHandles.push({ close: () => h.disconnect() });
      for (const h of [queueA, queueB, workerA, workerB])
        openHandles.push({ close: () => h.close() });

      await new Promise((resolve) => setTimeout(resolve, 500));

      await queueA.add('job', { marker: 'from-A' });
      await queueB.add('job', { marker: 'from-B' });

      await new Promise((resolve) => setTimeout(resolve, 2000));

      expect(seenByA).toEqual(['from-A']);
      expect(seenByB).toEqual(['from-B']);
    }, 10000);

    it("reaches a real, UNEDITED business-domain file (EventBusService) transparently: two instances built with two different simulated per-process prefixes never cross-consume each other's published events", async () => {
      // Dynamically required (not a static top-level import) so this file's own
      // `import { Queue, Worker } from 'bullmq'` above — already resolved once
      // through moduleNameMapper when this test file loaded — isn't implicated:
      // this require proves EventBusService's OWN `import { Queue } from 'bullmq'`
      // (a separate, unedited source file) independently resolves through the
      // same mapping.
      const { EventBusService } =
        await import('../src/core/events/event-bus.service');
      const { EVENTS_QUEUE_NAME } =
        await import('../src/core/events/event-names');
      const fakeConfigService = {
        getOrThrow: (key: string) => {
          if (key !== 'REDIS_URL') {
            throw new Error(`unexpected config key: ${key}`);
          }
          return BASE_URL;
        },
      };

      // Prefixes AND job-derived ids must be unique per test run, not fixed
      // literals: this Redis (db 1) is a real, persistent shared instance —
      // BullMQ silently no-ops `queue.add()` for a jobId that already exists
      // (see EventBusService.publish()'s own dedup comment), so a repeat run
      // reusing the same prefix + orgId/leadId would find the job already
      // `completed` from a PRIOR run and never re-enqueue it, making the
      // worker below spuriously see nothing. `process.pid` alone isn't
      // enough across repeated manual invocations of the same test in
      // separate processes, so a random suffix is added too.
      const runId = `${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
      const prefixA = `auto_domain_a_${runId}`;
      const prefixB = `auto_domain_b_${runId}`;

      process.env.TEST_RUN_BULLMQ_PREFIX = prefixA;
      const eventBusA = new EventBusService(fakeConfigService as never);
      process.env.TEST_RUN_BULLMQ_PREFIX = prefixB;
      const eventBusB = new EventBusService(fakeConfigService as never);
      openHandles.push({ close: () => eventBusA.onModuleDestroy() });
      openHandles.push({ close: () => eventBusB.onModuleDestroy() });

      const seenByA: string[] = [];
      const seenByB: string[] = [];
      const connWorkerA = new IORedis(BASE_URL, { maxRetriesPerRequest: null });
      const connWorkerB = new IORedis(BASE_URL, { maxRetriesPerRequest: null });
      openHandles.push({ close: () => connWorkerA.disconnect() });
      openHandles.push({ close: () => connWorkerB.disconnect() });
      const workerA = new Worker<EventJobData>(
        EVENTS_QUEUE_NAME,
        (job) => {
          seenByA.push(job.data.organizationId);
          return Promise.resolve();
        },
        { connection: connWorkerA, prefix: prefixA },
      );
      const workerB = new Worker<EventJobData>(
        EVENTS_QUEUE_NAME,
        (job) => {
          seenByB.push(job.data.organizationId);
          return Promise.resolve();
        },
        { connection: connWorkerB, prefix: prefixB },
      );
      openHandles.push({ close: () => workerA.close() });
      openHandles.push({ close: () => workerB.close() });

      await new Promise((resolve) => setTimeout(resolve, 500));

      await eventBusA.publish(`org-from-A-${runId}`, 'lead.created', {
        leadId: `lead-a-${runId}`,
      });
      await eventBusB.publish(`org-from-B-${runId}`, 'lead.created', {
        leadId: `lead-b-${runId}`,
      });

      await new Promise((resolve) => setTimeout(resolve, 2000));

      expect(seenByA).toEqual([`org-from-A-${runId}`]);
      expect(seenByB).toEqual([`org-from-B-${runId}`]);
    }, 10000);
  });
});
