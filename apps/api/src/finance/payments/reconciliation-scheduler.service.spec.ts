import type { ConfigService } from '@nestjs/config';
import { ReconciliationSchedulerService } from './reconciliation-scheduler.service';
import type { PaymentReconciliationService } from './payment-reconciliation.service';

const upsertJobSchedulerMock = jest.fn();
const queueCloseMock = jest.fn();
const workerOnMock = jest.fn();
const workerCloseMock = jest.fn();
const disconnectMock = jest.fn();

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    upsertJobScheduler: upsertJobSchedulerMock,
    close: queueCloseMock,
  })),
  Worker: jest.fn().mockImplementation(() => ({
    on: workerOnMock,
    close: workerCloseMock,
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
  });

  it('registers the job scheduler with attempts, exponential backoff, and a bounded removeOnComplete/removeOnFail policy', async () => {
    const service = buildService();

    await service.onModuleInit();

    expect(upsertJobSchedulerMock).toHaveBeenCalledTimes(1);
    const [, , jobTemplate] = upsertJobSchedulerMock.mock.calls[0];
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
});
