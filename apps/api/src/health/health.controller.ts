import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
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
      throw new ServiceUnavailableException({
        code: 'DATABASE_UNAVAILABLE',
        message: (error as Error).message,
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
      throw new ServiceUnavailableException({
        code: 'REDIS_UNAVAILABLE',
        message: (error as Error).message,
      });
    } finally {
      client.disconnect();
    }
  }
}
