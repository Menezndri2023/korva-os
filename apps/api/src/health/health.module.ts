import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { MetricsController } from './metrics.controller';
import { QueueMetricsService } from './queue-metrics.service';
import { QueueAlertingService } from './queue-alerting.service';

@Module({
  controllers: [HealthController, MetricsController],
  providers: [QueueMetricsService, QueueAlertingService],
})
export class HealthModule {}
