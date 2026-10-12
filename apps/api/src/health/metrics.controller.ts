import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Public } from '../common/decorators/public.decorator';
import { QueueMetricsService } from './queue-metrics.service';

/**
 * Prometheus scrape endpoint — closes the "Metrics (Prometheus): NOT_IMPLEMENTED" finding in
 * docs/PRODUCTION_READINESS.md §19. Hand-rolled rather than pulling in `prom-client`: everything
 * exposed here is already known to the process (BullMQ job counts via QueueMetricsService, plus
 * `process` itself), and the exposition format is a few lines of text — a dependency would buy
 * default collectors this app has no use for.
 *
 * Exposes ONLY aggregate queue counts and process-level numbers. No tenant identifier, no
 * entity id, no job payload — the same content boundary GET /health/queues already holds (see
 * QueueMetricsService's own doc comment on why getJobCounts() is the only call it makes).
 *
 * ACCESS: `@Public()` because a Prometheus scraper cannot present a tenant JWT, matching the
 * other /health/* routes. Set METRICS_TOKEN to require `Authorization: Bearer <token>` on top of
 * that; leave it unset and this behaves exactly like /health/queues. Either way, operational
 * state is still state — restrict this route at the ingress/network layer in production rather
 * than relying on the token alone.
 */
@Controller()
export class MetricsController {
  private readonly logger = new Logger(MetricsController.name);

  constructor(
    private readonly queueMetricsService: QueueMetricsService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @ApiExcludeEndpoint()
  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  // Prometheus caches nothing, but an intermediate proxy happily would — and a cached scrape is
  // a silently frozen dashboard.
  @Header('Cache-Control', 'no-store')
  async metrics(
    @Headers('authorization') authorization?: string,
  ): Promise<string> {
    this.assertAuthorized(authorization);

    let queues: Awaited<ReturnType<QueueMetricsService['getMetrics']>>;
    try {
      queues = await this.queueMetricsService.getMetrics();
    } catch (error) {
      // Same redaction rule as HealthController's own handlers: the real error (which can carry
      // connection-string fragments) is logged, never returned.
      this.logger.error('Queue metrics unavailable for scrape', error);
      throw new ServiceUnavailableException({
        code: 'METRICS_UNAVAILABLE',
        message: 'Metrics are currently unavailable',
      });
    }

    const memory = process.memoryUsage();
    const lines: string[] = [
      '# HELP korva_queue_jobs Number of BullMQ jobs per queue and state.',
      '# TYPE korva_queue_jobs gauge',
    ];

    for (const [queue, counts] of Object.entries(queues)) {
      for (const [state, value] of Object.entries(counts)) {
        lines.push(
          `korva_queue_jobs{queue="${escapeLabel(queue)}",state="${escapeLabel(state)}"} ${value}`,
        );
      }
    }

    lines.push(
      '# HELP korva_process_resident_memory_bytes Resident set size of this API process.',
      '# TYPE korva_process_resident_memory_bytes gauge',
      `korva_process_resident_memory_bytes ${memory.rss}`,
      '# HELP korva_process_heap_used_bytes V8 heap actually in use.',
      '# TYPE korva_process_heap_used_bytes gauge',
      `korva_process_heap_used_bytes ${memory.heapUsed}`,
      '# HELP korva_process_uptime_seconds Seconds since this process started.',
      '# TYPE korva_process_uptime_seconds gauge',
      `korva_process_uptime_seconds ${Math.round(process.uptime())}`,
    );

    // The exposition format requires a trailing newline.
    return `${lines.join('\n')}\n`;
  }

  private assertAuthorized(authorization?: string): void {
    const expected = this.configService.get<string>('METRICS_TOKEN');
    if (!expected) return;
    if (authorization !== `Bearer ${expected}`) {
      throw new ForbiddenException({
        code: 'METRICS_FORBIDDEN',
        message: 'Invalid metrics token',
      });
    }
  }
}

/** Escapes the three characters the Prometheus exposition format reserves inside a label value.
 *  Queue names and states are all internal constants today, so this can never actually fire —
 *  it is here so a future queue name containing a quote cannot produce a malformed scrape. */
function escapeLabel(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/"/g, '\\"');
}
