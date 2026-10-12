import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { MetricsController } from './metrics.controller';
import type { QueueMetricsService } from './queue-metrics.service';

const QUEUE_SAMPLE = {
  events: {
    waiting: 3,
    active: 1,
    completed: 120,
    failed: 2,
    delayed: 0,
    paused: 0,
  },
};

function build(
  options: { token?: string; metrics?: unknown; throws?: boolean } = {},
): MetricsController {
  const queueMetricsService = {
    getMetrics: options.throws
      ? jest.fn().mockRejectedValue(new Error('redis://user:pass@host down'))
      : jest.fn().mockResolvedValue(options.metrics ?? QUEUE_SAMPLE),
  } as unknown as QueueMetricsService;
  const configService = {
    get: jest
      .fn()
      .mockImplementation((key: string) =>
        key === 'METRICS_TOKEN' ? options.token : undefined,
      ),
  } as unknown as ConfigService;
  return new MetricsController(queueMetricsService, configService);
}

describe('MetricsController', () => {
  it('renders queue counts as Prometheus gauges with queue and state labels', async () => {
    const body = await build().metrics();

    expect(body).toContain('# TYPE korva_queue_jobs gauge');
    expect(body).toContain(
      'korva_queue_jobs{queue="events",state="waiting"} 3',
    );
    expect(body).toContain('korva_queue_jobs{queue="events",state="failed"} 2');
  });

  it('includes process gauges and ends with the newline the exposition format requires', async () => {
    const body = await build().metrics();

    expect(body).toContain('korva_process_resident_memory_bytes ');
    expect(body).toContain('korva_process_heap_used_bytes ');
    expect(body).toContain('korva_process_uptime_seconds ');
    expect(body.endsWith('\n')).toBe(true);
  });

  it('exposes no tenant or job identifiers — only queue names and states', async () => {
    const body = await build({
      metrics: {
        events: {
          waiting: 1,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
          paused: 0,
        },
      },
    }).metrics();

    // The events queue's jobId is `${organizationId}:${eventName}:${entityId}`; nothing
    // resembling one may ever reach a scrape.
    expect(body).not.toMatch(/[0-9a-f]{24}/);
  });

  it('is open when METRICS_TOKEN is unset, matching /health/queues', async () => {
    await expect(build().metrics()).resolves.toContain('korva_queue_jobs');
  });

  it('requires a matching bearer token once METRICS_TOKEN is set', async () => {
    const controller = build({ token: 's3cret' });

    await expect(controller.metrics()).rejects.toThrow(ForbiddenException);
    await expect(controller.metrics('Bearer wrong')).rejects.toThrow(
      ForbiddenException,
    );
    await expect(controller.metrics('Bearer s3cret')).resolves.toContain(
      'korva_queue_jobs',
    );
  });

  it('never leaks the underlying error when the queue read fails', async () => {
    const controller = build({ throws: true });

    await expect(controller.metrics()).rejects.toThrow(
      ServiceUnavailableException,
    );
    await expect(controller.metrics()).rejects.not.toThrow(
      /redis:\/\/user:pass/,
    );
  });
});
