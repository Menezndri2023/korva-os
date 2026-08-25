import { spawnSync } from 'node:child_process';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

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
});
