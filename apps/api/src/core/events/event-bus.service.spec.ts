import { EventBusService } from './event-bus.service';
import type { ConfigService } from '@nestjs/config';

type QueueAddCall = [string, Record<string, unknown>, Record<string, unknown>];
const addMock = jest.fn<Promise<void>, QueueAddCall>();
const closeMock = jest.fn();
const disconnectMock = jest.fn();

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: addMock,
    close: closeMock,
  })),
}));

jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({
    disconnect: disconnectMock,
  })),
);

function buildService(): EventBusService {
  const configService = {
    getOrThrow: jest.fn().mockReturnValue('redis://localhost:6379'),
  } as unknown as ConfigService;
  return new EventBusService(configService);
}

describe('EventBusService — retry/backoff/jobId', () => {
  beforeEach(() => {
    addMock.mockReset().mockResolvedValue(undefined);
  });

  it('publishes with attempts, exponential backoff, and a bounded removeOnComplete policy', async () => {
    const service = buildService();

    await service.publish('org-1', 'lead.created', { leadId: 'lead-1' });

    expect(addMock).toHaveBeenCalledTimes(1);
    const [, , options] = addMock.mock.calls[0]!;
    expect(options).toMatchObject({
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: false,
    });
  });

  it('sets a deterministic jobId derived from the entity id when one is available', async () => {
    const service = buildService();

    await service.publish('org-1', 'lead.created', { leadId: 'lead-1' });

    const [, data, options] = addMock.mock.calls[0]!;
    expect(options.jobId).toBe('org-1:lead.created:lead-1');
    expect(data.eventKey).toBe('lead.created:lead-1');
  });

  it('falls back to no jobId/eventKey when the payload has no resolvable entity id', async () => {
    const service = buildService();

    await service.publish('org-1', 'lead.created', {});

    const [, data, options] = addMock.mock.calls[0]!;
    expect(options.jobId).toBeUndefined();
    expect(data.eventKey).toBeUndefined();
  });

  it('never throws when queue.add() fails — publishing must stay non-blocking', async () => {
    addMock.mockRejectedValueOnce(new Error('Redis unreachable'));
    const service = buildService();

    await expect(
      service.publish('org-1', 'lead.created', { leadId: 'lead-1' }),
    ).resolves.toBeUndefined();
  });
});
