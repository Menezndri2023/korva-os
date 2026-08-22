import type { ConfigService } from '@nestjs/config';
import { EVENTS_QUEUE_NAME } from '../core/events/event-names';
import { RECONCILIATION_QUEUE_NAME } from '../finance/payments/reconciliation-scheduler.service';

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

  it('opens Queue clients for exactly the events and payment-reconciliation queue names when called', async () => {
    const service = buildService();

    await service.getMetrics();

    expect(constructedQueueNames.sort()).toEqual(
      [EVENTS_QUEUE_NAME, RECONCILIATION_QUEUE_NAME].sort(),
    );
  });

  it('calls getJobCounts on both queues and returns the six known counts, keyed by queue name', async () => {
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

    expect(getJobCountsMock).toHaveBeenCalledTimes(2);
    expect(getJobCountsMock).toHaveBeenCalledWith(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
      'paused',
    );
    expect(Object.keys(metrics).sort()).toEqual(
      [EVENTS_QUEUE_NAME, RECONCILIATION_QUEUE_NAME].sort(),
    );
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

    const { Queue } = jest.requireMock('bullmq') as { Queue: jest.Mock };
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

  it('closes both queues and disconnects after every call, including a failed one', async () => {
    const service = buildService();
    await service.getMetrics();

    expect(closeMock).toHaveBeenCalledTimes(2);
    expect(disconnectMock).toHaveBeenCalledTimes(1);

    closeMock.mockClear();
    disconnectMock.mockClear();
    getJobCountsMock.mockRejectedValueOnce(new Error('boom'));

    await expect(service.getMetrics()).rejects.toThrow('boom');
    expect(closeMock).toHaveBeenCalledTimes(2);
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });
});
