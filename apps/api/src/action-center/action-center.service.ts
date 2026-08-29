import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { ActionCenterItem, ActionCenterSummary } from '@korva/types';
import {
  AiPendingAction,
  AiPendingActionDocument,
} from '../ai/schemas/ai-pending-action.schema';
import {
  Recommendation,
  RecommendationDocument,
} from '../decision-engine/schemas/recommendation.schema';
import {
  WorkflowExecution,
  WorkflowExecutionDocument,
} from '../workflow/schemas/workflow-execution.schema';

const FEED_LIMIT_PER_CATEGORY = 20;
const PENDING_APPROVAL_STATUSES = ['pending', 'confirming'];
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The Action Center (docs/BUSINESS_OS_AUDIT.md §9, item #4): a single home for everything that
 * needs a human's attention across the system — pending AI tool-call approvals, open Decision
 * Engine recommendations, and failed automation runs — instead of each living only in its own
 * module's own page. Read-only aggregation over existing collections, same direct-model-
 * injection pattern as AnalyticsService/BusinessGraphService; nothing here is a new source of
 * truth.
 */
@Injectable()
export class ActionCenterService {
  constructor(
    @InjectModel(AiPendingAction.name)
    private readonly aiPendingActionModel: Model<AiPendingActionDocument>,
    @InjectModel(Recommendation.name)
    private readonly recommendationModel: Model<RecommendationDocument>,
    @InjectModel(WorkflowExecution.name)
    private readonly workflowExecutionModel: Model<WorkflowExecutionDocument>,
  ) {}

  async getSummary(organizationId: string): Promise<ActionCenterSummary> {
    const organizationObjectId = new Types.ObjectId(organizationId);
    const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS);

    const [pendingApprovals, recommendations, automatedThisWeek, failures] =
      await Promise.all([
        this.aiPendingActionModel.countDocuments({
          organizationId: organizationObjectId,
          status: { $in: PENDING_APPROVAL_STATUSES },
        }),
        this.recommendationModel.countDocuments({
          organizationId: organizationObjectId,
          status: 'open',
        }),
        this.workflowExecutionModel.countDocuments({
          organizationId: organizationObjectId,
          status: 'success',
          createdAt: { $gte: sevenDaysAgo },
        }),
        this.workflowExecutionModel.countDocuments({
          organizationId: organizationObjectId,
          status: 'failed',
          createdAt: { $gte: sevenDaysAgo },
        }),
      ]);

    return { pendingApprovals, recommendations, automatedThisWeek, failures };
  }

  async getFeed(organizationId: string): Promise<ActionCenterItem[]> {
    const organizationObjectId = new Types.ObjectId(organizationId);
    const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS);

    const [pendingActions, recommendations, failures] = await Promise.all([
      this.aiPendingActionModel
        .find({
          organizationId: organizationObjectId,
          status: { $in: PENDING_APPROVAL_STATUSES },
        })
        .sort({ createdAt: -1 })
        .limit(FEED_LIMIT_PER_CATEGORY)
        .exec(),
      this.recommendationModel
        .find({ organizationId: organizationObjectId, status: 'open' })
        .sort({ createdAt: -1 })
        .limit(FEED_LIMIT_PER_CATEGORY)
        .exec(),
      this.workflowExecutionModel
        .find({
          organizationId: organizationObjectId,
          status: 'failed',
          createdAt: { $gte: sevenDaysAgo },
        })
        .sort({ createdAt: -1 })
        .limit(FEED_LIMIT_PER_CATEGORY)
        .exec(),
    ]);

    const items: ActionCenterItem[] = [
      ...pendingActions.map((action) => ({
        type: 'pending_approval' as const,
        id: action.id as string,
        title: `Confirmation requise : ${action.toolName}`,
        occurredAt: (
          action as unknown as { createdAt: Date }
        ).createdAt.toISOString(),
        entityType: 'conversation',
        entityId: action.conversationId.toString(),
      })),
      ...recommendations.map((recommendation) => ({
        type: 'recommendation' as const,
        id: recommendation.id as string,
        title: recommendation.title,
        description: recommendation.description,
        occurredAt: (
          recommendation as unknown as { createdAt: Date }
        ).createdAt.toISOString(),
        entityType: recommendation.entityType,
        entityId: recommendation.entityId.toString(),
      })),
      ...failures.map((execution) => ({
        type: 'workflow_failure' as const,
        id: execution.id as string,
        title: `Échec d'automatisation pour l'événement "${execution.eventName}"`,
        description: execution.error,
        occurredAt: (
          execution as unknown as { createdAt: Date }
        ).createdAt.toISOString(),
        entityType: 'workflow',
        entityId: execution.workflowId.toString(),
      })),
    ];

    items.sort(
      (a, b) =>
        new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    );
    return items;
  }
}
