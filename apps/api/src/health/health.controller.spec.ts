import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { Connection } from 'mongoose';
import type { ConfigService } from '@nestjs/config';

jest.mock('ioredis');
import IORedis from 'ioredis';
import { HealthController } from './health.controller';
import type { QueueMetricsService } from './queue-metrics.service';

/** A ConfigService that knows nothing — every key reads as unset. GET /health/queues now
 *  consults METRICS_TOKEN and NODE_ENV (see operational-access.ts), so a bare `{}` no longer
 *  satisfies the constructor. With NODE_ENV unset the guard stays open, which is what these
 *  tests are about. */
const EMPTY_CONFIG = { get: () => undefined };

function buildController(
  mongooseConnection: unknown,
  configService: unknown,
  queueMetricsService: unknown = {},
): HealthController {
  return new HealthController(
    mongooseConnection as Connection,
    configService as ConfigService,
    queueMetricsService as QueueMetricsService,
  );
}

describe('HealthController — public endpoints never leak internal error details', () => {
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    (IORedis as unknown as jest.Mock).mockReset();
  });

  afterEach(() => {
    loggerErrorSpy.mockRestore();
  });

  it('returns a generic message on a MongoDB failure and logs the real one server-side', async () => {
    const internalMessage =
      'connect ECONNREFUSED 10.0.0.5:27017 authSource=admin user=korva password=***';
    const mongooseConnection = {
      db: {
        admin: () => ({
          ping: () => Promise.reject(new Error(internalMessage)),
        }),
      },
    };
    const controller = buildController(mongooseConnection, {});

    let caught: ServiceUnavailableException | undefined;
    try {
      await controller.database();
    } catch (error) {
      caught = error as ServiceUnavailableException;
    }

    expect(caught).toBeInstanceOf(ServiceUnavailableException);
    const response = caught!.getResponse() as { code: string; message: string };
    expect(response).toEqual({
      code: 'DATABASE_UNAVAILABLE',
      message: 'Database is currently unavailable',
    });
    expect(JSON.stringify(response)).not.toContain(internalMessage);
    expect(JSON.stringify(response)).not.toContain('10.0.0.5');
    expect(JSON.stringify(response)).not.toContain('korva');

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Database health check failed',
      expect.any(Error),
    );
  });

  it('returns a generic message on a Redis failure and logs the real one server-side', async () => {
    const internalMessage =
      'Redis connection to redis://internal-redis.prod.local:6379 failed: ECONNREFUSED';
    const connect = jest.fn().mockRejectedValue(new Error(internalMessage));
    const disconnect = jest.fn();
    (IORedis as unknown as jest.Mock).mockImplementation(() => ({
      connect,
      ping: jest.fn(),
      disconnect,
    }));

    const configService = {
      getOrThrow: () => 'redis://internal-redis.prod.local:6379',
    };
    const controller = buildController({}, configService);

    let caught: ServiceUnavailableException | undefined;
    try {
      await controller.redis();
    } catch (error) {
      caught = error as ServiceUnavailableException;
    }

    expect(caught).toBeInstanceOf(ServiceUnavailableException);
    const response = caught!.getResponse() as { code: string; message: string };
    expect(response).toEqual({
      code: 'REDIS_UNAVAILABLE',
      message: 'Redis is currently unavailable',
    });
    expect(JSON.stringify(response)).not.toContain(internalMessage);
    expect(JSON.stringify(response)).not.toContain('internal-redis.prod.local');
    expect(disconnect).toHaveBeenCalledTimes(1);

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Redis health check failed',
      expect.any(Error),
    );
  });

  it('leaves the unauthenticated /health status endpoint untouched', () => {
    const controller = buildController({}, {});
    expect(controller.status()).toEqual({ status: 'ok' });
  });

  it('returns a generic message when queue metrics fail, and logs the real one server-side', async () => {
    const internalMessage =
      'Redis connection to redis://internal-redis.prod.local:6379 failed';
    const queueMetricsService = {
      getMetrics: jest.fn().mockRejectedValue(new Error(internalMessage)),
    };
    const controller = buildController({}, EMPTY_CONFIG, queueMetricsService);

    let caught: ServiceUnavailableException | undefined;
    try {
      await controller.queues();
    } catch (error) {
      caught = error as ServiceUnavailableException;
    }

    expect(caught).toBeInstanceOf(ServiceUnavailableException);
    const response = caught!.getResponse() as { code: string; message: string };
    expect(response).toEqual({
      code: 'QUEUE_METRICS_UNAVAILABLE',
      message: 'Queue metrics are currently unavailable',
    });
    expect(JSON.stringify(response)).not.toContain(internalMessage);
    expect(JSON.stringify(response)).not.toContain('internal-redis.prod.local');

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Queue metrics unavailable',
      expect.any(Error),
    );
  });
});

describe('HealthController — GET /health/queues', () => {
  it('returns exactly what QueueMetricsService.getMetrics() resolves with, untouched', async () => {
    const metrics = {
      events: {
        waiting: 0,
        active: 1,
        completed: 412,
        failed: 2,
        delayed: 0,
        paused: 0,
      },
      'payment-reconciliation': {
        waiting: 0,
        active: 0,
        completed: 98,
        failed: 0,
        delayed: 0,
        paused: 0,
      },
    };
    const queueMetricsService = {
      getMetrics: jest.fn().mockResolvedValue(metrics),
    };
    const controller = buildController({}, EMPTY_CONFIG, queueMetricsService);

    const result = await controller.queues();

    expect(result).toEqual(metrics);
    expect(queueMetricsService.getMetrics).toHaveBeenCalledTimes(1);
  });

  it('never contains job-level or tenant-identifying fields, only the two known queue names and numeric counts', async () => {
    const metrics = {
      events: {
        waiting: 0,
        active: 0,
        completed: 5,
        failed: 1,
        delayed: 0,
        paused: 0,
      },
      'payment-reconciliation': {
        waiting: 0,
        active: 0,
        completed: 3,
        failed: 0,
        delayed: 0,
        paused: 0,
      },
    };
    const queueMetricsService = {
      getMetrics: jest.fn().mockResolvedValue(metrics),
    };
    const controller = buildController({}, EMPTY_CONFIG, queueMetricsService);

    const result = (await controller.queues()) as unknown as Record<
      string,
      Record<string, unknown>
    >;

    for (const counts of Object.values(result)) {
      const keys = Object.keys(counts);
      expect(keys.sort()).toEqual(
        [
          'active',
          'completed',
          'delayed',
          'failed',
          'paused',
          'waiting',
        ].sort(),
      );
      for (const value of Object.values(counts)) {
        expect(typeof value).toBe('number');
      }
    }
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      'organizationId',
      'entityId',
      'eventKey',
      'jobId',
      'payload',
      'workflowId',
      'actionIndex',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  /**
   * The route's content was always operational rather than tenant data, and it was public for
   * that reason. That reasoning was wrong about the consequence: in production it named all
   * thirteen queues and their volumes to anyone, and each unauthenticated call fanned out to a
   * getJobCounts per queue. These assert the guard at the controller, not just in
   * operational-access.spec.ts, so the wiring itself cannot be removed unnoticed.
   */
  describe('METRICS_TOKEN guard', () => {
    function configWith(values: Record<string, string | undefined>) {
      return { get: (key: string) => values[key] };
    }

    it('refuses in production when no token is configured, without touching the queues', async () => {
      const getMetrics = jest.fn();
      const controller = buildController(
        {},
        configWith({ NODE_ENV: 'production', METRICS_TOKEN: undefined }),
        { getMetrics },
      );

      await expect(controller.queues()).rejects.toMatchObject({
        response: { code: 'METRICS_NOT_CONFIGURED' },
      });
      // The point of refusing early: no Redis round-trip per queue for an anonymous caller.
      expect(getMetrics).not.toHaveBeenCalled();
    });

    it('refuses a wrong bearer token and allows the right one', async () => {
      const metrics = { events: { waiting: 0 } };
      const getMetrics = jest.fn().mockResolvedValue(metrics);
      const controller = buildController(
        {},
        configWith({ NODE_ENV: 'production', METRICS_TOKEN: 'tok' }),
        { getMetrics },
      );

      await expect(controller.queues('Bearer nope')).rejects.toMatchObject({
        response: { code: 'METRICS_FORBIDDEN' },
      });
      expect(getMetrics).not.toHaveBeenCalled();

      await expect(controller.queues('Bearer tok')).resolves.toEqual(metrics);
      expect(getMetrics).toHaveBeenCalledTimes(1);
    });
  });
});
