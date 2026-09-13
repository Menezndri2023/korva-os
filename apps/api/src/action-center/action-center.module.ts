import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AiPendingAction,
  AiPendingActionSchema,
} from '../ai/schemas/ai-pending-action.schema';
import {
  Recommendation,
  RecommendationSchema,
} from '../decision-engine/schemas/recommendation.schema';
import {
  WorkflowExecution,
  WorkflowExecutionSchema,
} from '../workflow/schemas/workflow-execution.schema';
import {
  WebhookDelivery,
  WebhookDeliverySchema,
} from '../webhook-subscriptions/schemas/webhook-delivery.schema';
import { ActionCenterService } from './action-center.service';
import { ActionCenterController } from './action-center.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AiPendingAction.name, schema: AiPendingActionSchema },
      { name: Recommendation.name, schema: RecommendationSchema },
      { name: WorkflowExecution.name, schema: WorkflowExecutionSchema },
      { name: WebhookDelivery.name, schema: WebhookDeliverySchema },
    ]),
  ],
  controllers: [ActionCenterController],
  providers: [ActionCenterService],
  // Phase F2 — AiModule's new global AI tool needs getFeed for its severity-ranked items.
  exports: [ActionCenterService],
})
export class ActionCenterModule {}
