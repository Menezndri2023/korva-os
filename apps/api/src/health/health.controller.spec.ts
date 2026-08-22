import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { Connection } from 'mongoose';
import type { ConfigService } from '@nestjs/config';

jest.mock('ioredis');
import IORedis from 'ioredis';
import { HealthController } from './health.controller';

function buildController(
  mongooseConnection: unknown,
  configService: unknown,
): HealthController {
  return new HealthController(
    mongooseConnection as Connection,
    configService as ConfigService,
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
});
