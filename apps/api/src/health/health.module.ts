import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { QueueMetricsService } from './queue-metrics.service';

@Module({
  controllers: [HealthController],
  providers: [QueueMetricsService],
})
export class HealthModule {}
