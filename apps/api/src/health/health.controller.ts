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

@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    @InjectConnection() private readonly mongooseConnection: Connection,
    private readonly configService: ConfigService,
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
}
