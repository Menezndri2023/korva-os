import type { ConfigService } from '@nestjs/config';
import { ReconciliationSchedulerService } from './reconciliation-scheduler.service';
import type { PaymentReconciliationService } from './payment-reconciliation.service';

const upsertJobSchedulerMock = jest.fn();
const queueCloseMock = jest.fn();
const queueOnMock = jest.fn();
const queueWaitUntilReadyMock = jest.fn();
const workerOnMock = jest.fn();
const workerCloseMock = jest.fn();
const workerWaitUntilReadyMock = jest.fn();
const disconnectMock = jest.fn();

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    upsertJobScheduler: upsertJobSchedulerMock,
    close: queueCloseMock,
    on: queueOnMock,
    waitUntilReady: queueWaitUntilReadyMock,
  })),
  Worker: jest.fn().mockImplementation(() => ({
    on: workerOnMock,
    close: workerCloseMock,
    waitUntilReady: workerWaitUntilReadyMock,
  })),
}));

jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({ disconnect: disconnectMock })),
);

function buildService(): ReconciliationSchedulerService {
  const configService = {
    getOrThrow: jest.fn().mockReturnValue('redis://localhost:6379'),
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'NODE_ENV') return 'production';
      return undefined;
    }),
  } as unknown as ConfigService;
  const reconciliationService = {
    reconcilePendingPayments: jest.fn(),
    reconcilePendingRefunds: jest.fn(),
  } as unknown as PaymentReconciliationService;
  return new ReconciliationSchedulerService(
    configService,
    reconciliationService,
  );
}

describe('ReconciliationSchedulerService — retry/backoff', () => {
  beforeEach(() => {
    upsertJobSchedulerMock.mockReset().mockResolvedValue(undefined);
    queueWaitUntilReadyMock.mockReset().mockResolvedValue(undefined);
    workerWaitUntilReadyMock.mockReset().mockResolvedValue(undefined);
    queueOnMock.mockReset();
    workerOnMock.mockReset();
  });

  it('registers the job scheduler with attempts, exponential backoff, and a bounded removeOnComplete/removeOnFail policy', async () => {
    const service = buildService();

    await service.onModuleInit();

    expect(upsertJobSchedulerMock).toHaveBeenCalledTimes(1);
    const call = upsertJobSchedulerMock.mock.calls[0] as unknown[];
    const jobTemplate: unknown = call[2];
    expect(jobTemplate).toEqual({
      name: 'sweep',
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: false,
      },
    });
  });

  // LOT E2E-INFRA-2: a Worker/Queue 'error' event with no listener is a Node-level fatal, and
  // BullMQ's own close() can emit one internally if the connection is still mid-handshake —
  // both must have a handler, and onModuleInit must wait for both connections to be fully ready
  // before it resolves, so onModuleDestroy never races an in-flight connection close.
  it('attaches an error handler to both the worker and the queue, and waits for both to be ready before returning', async () => {
    const service = buildService();

    await service.onModuleInit();

    expect(workerOnMock).toHaveBeenCalledWith('error', expect.any(Function));
    expect(queueOnMock).toHaveBeenCalledWith('error', expect.any(Function));
    expect(workerWaitUntilReadyMock).toHaveBeenCalledTimes(1);
    expect(queueWaitUntilReadyMock).toHaveBeenCalledTimes(1);
  });
});
