import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type { Pagination, RecommendationEntityType } from '@korva/types';
import {
  FindRecommendationsOptions,
  RecommendationsRepository,
} from './recommendations.repository';
import { RecommendationDocument } from './schemas/recommendation.schema';
import { AuditService } from '../audit/audit.service';

/** Fixed ruleKey for every AI-drafted recommendation — never AI-supplied. Keeps AI suggestions
 *  identifiable at a glance in the recommendations list (vs. decision-engine/rules/*'s own
 *  ruleKeys like 'invoice_overdue_followup'), and — via the schema's existing unique index on
 *  {organizationId, ruleKey, entityType, entityId} — means the AI can propose at most once per
 *  entity ever, the same one-shot-per-entity guarantee the Decision Engine already relies on. */
const AI_SUGGESTION_RULE_KEY = 'ai_suggestion';

@Injectable()
export class RecommendationsService {
  constructor(
    private readonly recommendationsRepository: RecommendationsRepository,
    private readonly auditService: AuditService,
  ) {}

  async getById(
    organizationId: string,
    id: string,
  ): Promise<RecommendationDocument> {
    const recommendation = await this.recommendationsRepository.findById(
      organizationId,
      id,
    );
    if (!recommendation) {
      throw new NotFoundException({
        code: 'RECOMMENDATION_NOT_FOUND',
        message: 'Recommendation not found',
      });
    }
    return recommendation;
  }

  async list(
    organizationId: string,
    query: FindRecommendationsOptions,
  ): Promise<{ data: RecommendationDocument[]; pagination: Pagination }> {
    const { data, total } = await this.recommendationsRepository.findAll(
      organizationId,
      query,
    );
    return {
      data,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  /**
   * The one path where a Recommendation is created OUTSIDE decision-engine/rules/* — lets the AI
   * surface a suggestion it noticed while helping staff (e.g. "ce client mérite une relance")
   * without ever acting on it itself: the row lands in the same open queue as a deterministic
   * rule's output, and only a human resolve/dismiss (via the existing controller or UI) closes
   * it. The Decision Engine's own rule evaluation stays entirely deterministic and untouched by
   * this — this is an additional *source* of recommendations, not a change to how existing ones
   * are produced. entityId is validated for shape only (not existence/ownership of the
   * referenced invoice/contact/offer) — the calling AI tool is expected to have obtained it from
   * a real prior tool call (get_customer, get_invoice, ...), consistent with every other AI tool
   * in this codebase never being trusted to invent IDs on its own.
   */
  async propose(
    organizationId: string,
    data: {
      title: string;
      description: string;
      entityType: RecommendationEntityType;
      entityId: string;
    },
  ): Promise<RecommendationDocument> {
    if (!Types.ObjectId.isValid(data.entityId)) {
      throw new BadRequestException({
        code: 'RECOMMENDATION_INVALID_ENTITY_ID',
        message: `"${data.entityId}" is not a valid entity id`,
      });
    }

    const created = await this.recommendationsRepository.createIfNotExists({
      organizationId: new Types.ObjectId(organizationId),
      ruleKey: AI_SUGGESTION_RULE_KEY,
      title: data.title,
      description: data.description,
      entityType: data.entityType,
      entityId: new Types.ObjectId(data.entityId),
    });
    if (!created) {
      throw new BadRequestException({
        code: 'RECOMMENDATION_ALREADY_EXISTS',
        message:
          'A recommendation already exists for this entity (open, dismissed, or resolved).',
      });
    }
    return created;
  }

  async dismiss(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<RecommendationDocument> {
    return this.transitionTo(organizationId, userId, id, 'dismissed');
  }

  async resolve(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<RecommendationDocument> {
    return this.transitionTo(organizationId, userId, id, 'resolved');
  }

  private async transitionTo(
    organizationId: string,
    userId: string,
    id: string,
    status: 'dismissed' | 'resolved',
  ): Promise<RecommendationDocument> {
    const recommendation = await this.getById(organizationId, id);
    if (recommendation.status !== 'open') {
      throw new BadRequestException({
        code: 'RECOMMENDATION_INVALID_TRANSITION',
        message: `Cannot transition a recommendation with status "${recommendation.status}" to "${status}"`,
      });
    }

    const updated = await this.recommendationsRepository.updateStatus(
      organizationId,
      id,
      status,
    );
    if (!updated) {
      throw new NotFoundException({
        code: 'RECOMMENDATION_NOT_FOUND',
        message: 'Recommendation not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'recommendation',
      entityId: id,
      metadata: { status },
    });

    return updated;
  }
}
