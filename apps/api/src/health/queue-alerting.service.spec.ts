import type { ConfigService } from '@nestjs/config';
import { EVENTS_QUEUE_NAME } from '../core/events/event-names';
import { RECONCILIATION_QUEUE_NAME } from '../finance/payments/reconciliation-scheduler.service';
import { QUOTE_EXPIRY_QUEUE_NAME } from '../finance/quotes/quote-expiry-scheduler.service';
import { INVOICE_OVERDUE_QUEUE_NAME } from '../finance/invoices/invoice-overdue-scheduler.service';
import { CALENDAR_SYNC_QUEUE_NAME } from '../booking/resources/calendar-sync-scheduler.service';
import { CUSTOMER_INACTIVITY_QUEUE_NAME } from '../crm/contacts/customer-inactivity-scheduler.service';
import { WEBHOOK_DELIVERY_QUEUE_NAME } from '../webhook-subscriptions/webhook-delivery.queue';
import { SUBSCRIPTION_PERIOD_QUEUE_NAME } from '../subscriptions/subscription-period-scheduler.service';

const ALL_QUEUE_NAMES = [
  EVENTS_QUEUE_NAME,
  RECONCILIATION_QUEUE_NAME,
  QUOTE_EXPIRY_QUEUE_NAME,
  INVOICE_OVERDUE_QUEUE_NAME,
  CALENDAR_SYNC_QUEUE_NAME,
  CUSTOMER_INACTIVITY_QUEUE_NAME,
  WEBHOOK_DELIVERY_QUEUE_NAME,
  SUBSCRIPTION_PERIOD_QUEUE_NAME,
];

interface MockQueueEventsInstance {
  name: string;
  connectionOptions: unknown;
  listeners: Record<string, ((...args: unknown[]) => void)[]>;
  on: jest.Mock<
    MockQueueEventsInstance,
    [string, (...args: unknown[]) => void]
  >;
  close: jest.Mock<Promise<void>, []>;
  emit(event: string, ...args: unknown[]): void;
}

const instances: MockQueueEventsInstance[] = [];
let closeShouldReject = false;

/**
 * Deliberately exposes ONLY `.on` and `.close` — the two methods QueueAlertingService actually
 * calls on a QueueEvents instance. A mock exposing every BullMQ method (getFailed, getJobs,
 * add, ...) would let an implementation that reaches for forbidden data pass unnoticed.
 */
jest.mock('bullmq', () => ({
  QueueEvents: jest.fn().mockImplementation((name: string, opts: unknown) => {
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
    const instance: MockQueueEventsInstance = {
      name,
      connectionOptions: opts,
      listeners,
      on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
        (listeners[event] ??= []).push(handler);
        return instance;
      }),
      close: jest.fn(() =>
        closeShouldReject
          ? Promise.reject(new Error('close failed'))
          : Promise.resolve(undefined),
      ),
      emit(event, ...args) {
        for (const handler of listeners[event] ?? []) handler(...args);
      },
    };
    instances.push(instance);
    return instance;
  }),
}));

import { QueueAlertingService } from './queue-alerting.service';

function buildService(): QueueAlertingService {
  const configService = {
    getOrThrow: jest.fn().mockReturnValue('redis://localhost:6379'),
  } as unknown as ConfigService;
  return new QueueAlertingService(configService);
}

describe('QueueAlertingService', () => {
  let loggerWarnSpy: jest.SpyInstance<void, unknown[]>;
  let loggerErrorSpy: jest.SpyInstance<void, unknown[]>;

  beforeEach(() => {
    instances.length = 0;
    closeShouldReject = false;
    jest.useRealTimers();
    const { Logger } =
      jest.requireActual<typeof import('@nestjs/common')>('@nestjs/common');
    loggerWarnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    loggerWarnSpy.mockRestore();
    loggerErrorSpy.mockRestore();
  });

  it('creates exactly eight QueueEvents, one per known queue name, without a connection created before onModuleInit', () => {
    const service = buildService();
    expect(instances).toHaveLength(0);

    service.onModuleInit();

    expect(instances).toHaveLength(8);
    expect(instances.map((i) => i.name).sort()).toEqual(
      [...ALL_QUEUE_NAMES].sort(),
    );
  });

  it('subscribes only to "failed" and "error" — no completed/active/delayed/waiting/progress/stalled listener', () => {
    const service = buildService();
    service.onModuleInit();

    for (const instance of instances) {
      const subscribedEvents = instance.on.mock.calls.map(([event]) => event);
      expect(subscribedEvents.sort()).toEqual(['error', 'failed']);
    }
  });

  it('logs a generic warning containing only the queue name when a job fails', () => {
    const service = buildService();
    service.onModuleInit();

    instances[0]!.emit('failed', {
      jobId: 'org-1:lead.created:lead-1',
      failedReason: 'boom',
    });

    expect(loggerWarnSpy).toHaveBeenCalledTimes(1);
    const [message] = loggerWarnSpy.mock.calls[0]!;
    expect(message).toContain(instances[0]!.name);
    expect(message).not.toContain('org-1');
    expect(message).not.toContain('lead-1');
    expect(message).not.toContain('boom');
  });

  it('never reads or forwards jobId, failedReason, or any job field from the failed event', () => {
    const service = buildService();
    service.onModuleInit();

    const sensitivePayload = {
      jobId: 'org-42:payment.completed:entity-99',
      failedReason:
        'organizationId=org-42 entityId=entity-99 eventKey=payment.completed:entity-99',
      prev: 'active',
      data: {
        organizationId: 'org-42',
        workflowId: 'wf-1',
        actionIndex: 0,
        payload: { secret: true },
      },
    };
    instances[0]!.emit('failed', sensitivePayload, 'stream-id-1');

    const allLoggedText = [
      ...loggerWarnSpy.mock.calls,
      ...loggerErrorSpy.mock.calls,
    ]
      .flat()
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join(' ');
    for (const forbidden of [
      'jobId',
      'failedReason',
      'org-42',
      'entity-99',
      'organizationId',
      'entityId',
      'eventKey',
      'workflowId',
      'actionIndex',
      'payload',
      'job.data',
      'wf-1',
      'secret',
      'payment.completed:entity-99',
    ]) {
      expect(allLoggedText).not.toContain(forbidden);
    }
  });

  it('cooldown: a second failure on the same queue within the window does not log again', () => {
    const service = buildService();
    service.onModuleInit();

    instances[0]!.emit('failed', {});
    instances[0]!.emit('failed', {});
    instances[0]!.emit('failed', {});

    expect(loggerWarnSpy).toHaveBeenCalledTimes(1);
  });

  it('cooldown is per queue: a failure on the second queue logs independently of the first', () => {
    const service = buildService();
    service.onModuleInit();

    instances[0]!.emit('failed', {});
    instances[1]!.emit('failed', {});

    expect(loggerWarnSpy).toHaveBeenCalledTimes(2);
  });

  it('logs again once the cooldown window has elapsed', () => {
    jest.useFakeTimers();
    const service = buildService();
    service.onModuleInit();

    instances[0]!.emit('failed', {});
    expect(loggerWarnSpy).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(5 * 60 * 1000 + 1);
    instances[0]!.emit('failed', {});

    expect(loggerWarnSpy).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it('an "error" event on a listener is logged (server-side, like the existing /health/redis check) and never throws', () => {
    const service = buildService();
    service.onModuleInit();

    // Connection-level errors (Redis unreachable) are logged server-side exactly like
    // HealthController's own /health/redis check already does — that's infra diagnostics, not
    // the job-level business data (jobId/organizationId/entityId) this service must redact.
    expect(() =>
      instances[0]!.emit('error', new Error('ECONNREFUSED 10.0.0.9:6379')),
    ).not.toThrow();
    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
    const [message, error] = loggerErrorSpy.mock.calls[0]!;
    expect(message).toContain(instances[0]!.name);
    expect(error).toBeInstanceOf(Error);
  });

  it('a construction failure on one queue does not prevent the others from starting', () => {
    const { QueueEvents } = jest.requireMock<{ QueueEvents: jest.Mock }>(
      'bullmq',
    );
    QueueEvents.mockImplementationOnce(() => {
      throw new Error('failed to init');
    });
    const service = buildService();

    expect(() => service.onModuleInit()).not.toThrow();
    expect(instances).toHaveLength(ALL_QUEUE_NAMES.length - 1);
    expect(loggerErrorSpy).toHaveBeenCalled();
  });

  it('closes every successfully-created listener on module destroy', async () => {
    const service = buildService();
    service.onModuleInit();

    await service.onModuleDestroy();

    expect(instances).toHaveLength(8);
    for (const instance of instances) {
      expect(instance.close).toHaveBeenCalledTimes(1);
    }
  });

  it('a failure to close one listener does not stop the other from closing, and never throws', async () => {
    closeShouldReject = true;
    const service = buildService();
    service.onModuleInit();

    await expect(service.onModuleDestroy()).resolves.toBeUndefined();

    for (const instance of instances) {
      expect(instance.close).toHaveBeenCalledTimes(1);
    }
    expect(loggerErrorSpy).toHaveBeenCalled();
  });

  it('destroy after a partial initialization failure only closes the listeners that actually started', async () => {
    const { QueueEvents } = jest.requireMock<{ QueueEvents: jest.Mock }>(
      'bullmq',
    );
    QueueEvents.mockImplementationOnce(() => {
      throw new Error('failed to init');
    });
    const service = buildService();
    service.onModuleInit();

    await service.onModuleDestroy();

    expect(instances).toHaveLength(ALL_QUEUE_NAMES.length - 1);
    for (const instance of instances) {
      expect(instance.close).toHaveBeenCalledTimes(1);
    }
  });

  it('destroy is safe to call twice', async () => {
    const service = buildService();
    service.onModuleInit();

    await service.onModuleDestroy();
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();

    for (const instance of instances) {
      expect(instance.close).toHaveBeenCalledTimes(2);
    }
  });
});
