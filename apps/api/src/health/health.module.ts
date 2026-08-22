import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { QueueMetricsService } from './queue-metrics.service';
import { QueueAlertingService } from './queue-alerting.service';

@Module({
  controllers: [HealthController],
  providers: [QueueMetricsService, QueueAlertingService],
})
export class HealthModule {}
