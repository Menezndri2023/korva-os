import type { ConfigService } from '@nestjs/config';
import { EVENTS_QUEUE_NAME } from '../core/events/event-names';
// Asserted against the registry rather than a second hardcoded list: duplicating the queue
// names here is exactly what let the production list fall 4 queues behind reality.
import { ALL_QUEUE_NAMES } from '../core/queues/queue-registry';

const getJobCountsMock = jest.fn();
const closeMock = jest.fn();
const disconnectMock = jest.fn();
const constructedQueueNames: string[] = [];

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation((name: string) => {
    constructedQueueNames.push(name);
    return { name, getJobCounts: getJobCountsMock, close: closeMock };
  }),
}));

jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({ disconnect: disconnectMock })),
);

import { QueueMetricsService } from './queue-metrics.service';

function buildService(): QueueMetricsService {
  const configService = {
    getOrThrow: jest.fn().mockReturnValue('redis://localhost:6379'),
    // `get` is read by backgroundWorkersDisabled (core/background/background-workers.ts);
    // undefined means "not disabled", which is what these tests exercise.
    get: jest.fn().mockReturnValue(undefined),
  } as unknown as ConfigService;
  return new QueueMetricsService(configService);
}

describe('QueueMetricsService', () => {
  beforeEach(() => {
    getJobCountsMock.mockReset().mockResolvedValue({
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      paused: 0,
    });
    closeMock.mockReset().mockResolvedValue(undefined);
    disconnectMock.mockReset();
    constructedQueueNames.length = 0;
  });

  it('never opens a Redis connection or a Queue client until getMetrics() is actually called', () => {
    buildService();

    expect(constructedQueueNames).toHaveLength(0);
    expect(disconnectMock).not.toHaveBeenCalled();
  });

  it('opens one Queue client per registered queue name when called', async () => {
    const service = buildService();

    await service.getMetrics();

    expect(constructedQueueNames.sort()).toEqual([...ALL_QUEUE_NAMES].sort());
  });

  it('calls getJobCounts on every registered queue and returns the six known counts, keyed by queue name', async () => {
    getJobCountsMock
      .mockResolvedValueOnce({
        waiting: 1,
        active: 2,
        completed: 412,
        failed: 3,
        delayed: 0,
        paused: 0,
      })
      .mockResolvedValueOnce({
        waiting: 0,
        active: 0,
        completed: 98,
        failed: 0,
        delayed: 0,
        paused: 0,
      });
    const service = buildService();

    const metrics = await service.getMetrics();

    expect(getJobCountsMock).toHaveBeenCalledTimes(ALL_QUEUE_NAMES.length);
    expect(getJobCountsMock).toHaveBeenCalledWith(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
      'paused',
    );
    expect(Object.keys(metrics).sort()).toEqual([...ALL_QUEUE_NAMES].sort());
    expect(metrics[EVENTS_QUEUE_NAME]).toEqual({
      waiting: 1,
      active: 2,
      completed: 412,
      failed: 3,
      delayed: 0,
      paused: 0,
    });
  });

  it('only ever calls getJobCounts — never getFailed/getJobs/getJob or any write method', async () => {
    const service = buildService();

    await service.getMetrics();

    const { Queue } = jest.requireMock<{
      Queue: jest.Mock<
        { name: string; getJobCounts: jest.Mock; close: jest.Mock },
        [string]
      >;
    }>('bullmq');
    for (const result of Queue.mock.results) {
      const instance = result.value as Record<string, unknown>;
      expect(instance.getFailed).toBeUndefined();
      expect(instance.getJobs).toBeUndefined();
      expect(instance.getJob).toBeUndefined();
      expect(instance.add).toBeUndefined();
    }
  });

  it('rejects the whole read (never returns partial zeros) when one queue fails', async () => {
    getJobCountsMock
      .mockResolvedValueOnce({
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        paused: 0,
      })
      .mockRejectedValueOnce(new Error('Redis unreachable'));
    const service = buildService();

    await expect(service.getMetrics()).rejects.toThrow('Redis unreachable');
  });

  it('closes every queue and disconnects after every call, including a failed one', async () => {
    const service = buildService();
    await service.getMetrics();

    expect(closeMock).toHaveBeenCalledTimes(ALL_QUEUE_NAMES.length);
    expect(disconnectMock).toHaveBeenCalledTimes(1);

    closeMock.mockClear();
    disconnectMock.mockClear();
    getJobCountsMock.mockRejectedValueOnce(new Error('boom'));

    await expect(service.getMetrics()).rejects.toThrow('boom');
    expect(closeMock).toHaveBeenCalledTimes(ALL_QUEUE_NAMES.length);
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });
});
