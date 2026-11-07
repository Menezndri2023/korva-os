import { Module } from '@nestjs/common';
import { ClientErrorsController } from './client-errors.controller';
import { HealthController } from './health.controller';
import { MetricsController } from './metrics.controller';
import { QueueMetricsService } from './queue-metrics.service';
import { QueueAlertingService } from './queue-alerting.service';

@Module({
  controllers: [HealthController, MetricsController, ClientErrorsController],
  providers: [QueueMetricsService, QueueAlertingService],
})
export class HealthModule {}
