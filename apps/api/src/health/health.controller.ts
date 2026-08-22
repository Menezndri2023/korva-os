import {
  Controller,
  Get,
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
   * Aggregate BullMQ job counts only (waiting/active/completed/failed/delayed/paused) for the
   * 'events' and 'payment-reconciliation' queues — never an individual job, so there is no
   * organizationId, entityId, eventKey, jobId, or payload to leak. Public like the other
   * /health/* endpoints for the same reason /health/redis already is: it reveals operational
   * state, not tenant data, matching this endpoint's own content exactly.
   */
  @Public()
  @Get('queues')
  async queues() {
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
