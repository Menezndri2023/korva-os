import type { ConfigService } from '@nestjs/config';
import { EventsProcessor } from './events.processor';
import type { WorkflowEngineService } from './workflow-engine.service';
import type { DecisionEngineService } from '../decision-engine/decision-engine.service';
import type { OrdersService } from '../commerce/orders/orders.service';
import type { WebhookDispatchService } from '../webhook-subscriptions/webhook-dispatch.service';
import type { WaitlistService } from '../booking/waitlist/waitlist.service';

const workerOnMock = jest.fn();
const workerCloseMock = jest.fn();
const workerWaitUntilReadyMock = jest.fn();
const disconnectMock = jest.fn();

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation(() => ({
    on: workerOnMock,
    close: workerCloseMock,
    waitUntilReady: workerWaitUntilReadyMock,
  })),
}));

jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({ disconnect: disconnectMock })),
);

function buildService(): EventsProcessor {
  const configService = {
    getOrThrow: jest.fn().mockReturnValue('redis://localhost:6379'),
    // `get` is read by backgroundWorkersDisabled (core/background/background-workers.ts);
    // undefined means "not disabled", which is what these tests exercise.
    get: jest.fn().mockReturnValue(undefined),
  } as unknown as ConfigService;
  const workflowEngineService = {} as unknown as WorkflowEngineService;
  const decisionEngineService = {} as unknown as DecisionEngineService;
  const ordersService = {} as unknown as OrdersService;
  const webhookDispatchService = {} as unknown as WebhookDispatchService;
  const waitlistService = {} as unknown as WaitlistService;
  return new EventsProcessor(
    configService,
    workflowEngineService,
    decisionEngineService,
    ordersService,
    webhookDispatchService,
    waitlistService,
  );
}

// LOT E2E-INFRA-2: reproduced (see finance/payments/reconciliation-scheduler.service.ts for the
// full causal chain) an unhandled "Connection is closed" error surfacing at the process level —
// not scoped to this service's own test file — whenever onModuleDestroy's worker.close() ran
// while the connection was still mid-handshake. Both fixes below are what prevent it: an 'error'
// handler (BullMQ's own close() can emit one internally) and waiting for the connection to be
// fully ready before onModuleInit resolves, so onModuleDestroy never races an in-flight connect.
describe('EventsProcessor — connection lifecycle', () => {
  beforeEach(() => {
    workerOnMock.mockReset();
    workerCloseMock.mockReset().mockResolvedValue(undefined);
    workerWaitUntilReadyMock.mockReset().mockResolvedValue(undefined);
    disconnectMock.mockReset();
  });

  it('attaches an error handler to the worker and waits for it to be ready before onModuleInit resolves', async () => {
    const service = buildService();

    await service.onModuleInit();

    expect(workerOnMock).toHaveBeenCalledWith('error', expect.any(Function));
    expect(workerWaitUntilReadyMock).toHaveBeenCalledTimes(1);
  });

  it('closes the worker and disconnects the connection on module destroy', async () => {
    const service = buildService();
    await service.onModuleInit();

    await service.onModuleDestroy();

    expect(workerCloseMock).toHaveBeenCalledTimes(1);
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });
});

describe('EventsProcessor — events with no organization', () => {
  it('skips an event published as "unresolved" instead of failing it five times', async () => {
    const { Worker } = jest.requireMock<{ Worker: jest.Mock }>('bullmq');
    Worker.mockClear();
    const handle = jest.fn().mockResolvedValue(undefined);
    const service = new EventsProcessor(
      {
        getOrThrow: jest.fn().mockReturnValue('redis://localhost:6379'),
        get: jest.fn().mockReturnValue(undefined),
      } as unknown as ConfigService,
      { handleEvent: handle } as unknown as WorkflowEngineService,
      { handleEvent: handle } as unknown as DecisionEngineService,
      {} as unknown as OrdersService,
      { dispatchEvent: handle } as unknown as WebhookDispatchService,
      {} as unknown as WaitlistService,
    );
    await service.onModuleInit();
    const [, processJob] = (Worker.mock.calls as unknown[][])[0] as [
      unknown,
      (job: unknown) => Promise<void>,
    ];

    await processJob({
      data: {
        organizationId: 'unresolved',
        name: 'payment.webhook_received',
        payload: {},
      },
    });
    expect(handle).not.toHaveBeenCalled();

    await processJob({
      data: {
        organizationId: '64b000000000000000000001',
        name: 'payment.webhook_received',
        payload: {},
      },
    });
    expect(handle).toHaveBeenCalledTimes(3);
  });
});
