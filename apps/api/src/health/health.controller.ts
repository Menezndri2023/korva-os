import {
  Controller,
  Get,
  Headers,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { Public } from '../common/decorators/public.decorator';
import { QueueMetricsService } from './queue-metrics.service';
import { assertOperationalAccess } from './operational-access';

@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    @InjectConnection() private readonly mongooseConnection: Connection,
    private readonly configService: ConfigService,
    private readonly queueMetricsService: QueueMetricsService,
  ) {}

  @Public()
  @Get()
  status() {
    return { status: 'ok' };
  }

  @Public()
  @Get('database')
  async database() {
    try {
      await this.mongooseConnection.db?.admin().ping();
      return { status: 'ok' };
    } catch (error) {
      this.logger.error('Database health check failed', error);
      throw new ServiceUnavailableException({
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database is currently unavailable',
      });
    }
  }

  @Public()
  @Get('redis')
  async redis() {
    const client = new IORedis(
      this.configService.getOrThrow<string>('REDIS_URL'),
      {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      },
    );
    try {
      await client.connect();
      await client.ping();
      return { status: 'ok' };
    } catch (error) {
      this.logger.error('Redis health check failed', error);
      throw new ServiceUnavailableException({
        code: 'REDIS_UNAVAILABLE',
        message: 'Redis is currently unavailable',
      });
    } finally {
      client.disconnect();
    }
  }

  /**
   * Aggregate BullMQ job counts only (waiting/active/completed/failed/delayed/paused) — never an
   * individual job, so there is no organizationId, entityId, eventKey, jobId or payload to leak.
   *
   * GUARDED BY METRICS_TOKEN since 2026-10-14, the same rule as `GET /metrics`
   * (operational-access.ts). It was plainly public before, on the reasoning that it reveals
   * operational state rather than tenant data — which is true of the content and was still the
   * wrong conclusion. In production it answered 200 to anyone, naming all thirteen queues and
   * their volumes, which is a map of the system and a usable read on business activity; and
   * because every call fans out to a `getJobCounts` per queue, an unauthenticated request turned
   * into thirteen-plus Redis commands, which makes a cheap amplifier. The Caddyfile had already
   * reached the opposite conclusion for `/api/v1/metrics`, which returns the same numbers.
   *
   * `/health`, `/health/database` and `/health/redis` stay public — an uptime monitor needs
   * those and they reveal one bit each.
   */
  @Public()
  @Get('queues')
  async queues(@Headers('authorization') authorization?: string) {
    assertOperationalAccess(
      this.configService.get<string>('METRICS_TOKEN'),
      authorization,
      this.configService.get<string>('NODE_ENV'),
    );
    try {
      return await this.queueMetricsService.getMetrics();
    } catch (error) {
      this.logger.error('Queue metrics unavailable', error);
      throw new ServiceUnavailableException({
        code: 'QUEUE_METRICS_UNAVAILABLE',
        message: 'Queue metrics are currently unavailable',
      });
    }
  }
}
