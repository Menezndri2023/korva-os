import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Recommendation,
  RecommendationSchema,
} from './schemas/recommendation.schema';
import { RecommendationsRepository } from './recommendations.repository';
import { RecommendationsService } from './recommendations.service';
import { RecommendationsController } from './recommendations.controller';
import { DecisionEngineService } from './decision-engine.service';
import { InvoiceOverdueFollowupRule } from './rules/invoice-overdue-followup.rule';
import { CustomerReactivationRule } from './rules/customer-reactivation.rule';
import { LowStockAlertRule } from './rules/low-stock-alert.rule';
import { LowStockThresholdAlertRule } from './rules/low-stock-threshold-alert.rule';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Recommendation.name, schema: RecommendationSchema },
    ]),
    AuditModule,
  ],
  controllers: [RecommendationsController],
  providers: [
    RecommendationsRepository,
    RecommendationsService,
    InvoiceOverdueFollowupRule,
    CustomerReactivationRule,
    LowStockAlertRule,
    LowStockThresholdAlertRule,
    DecisionEngineService,
  ],
  exports: [DecisionEngineService, RecommendationsService],
})
export class DecisionEngineModule {}
