import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Pagination } from '@korva/types';
import {
  FindRecommendationsOptions,
  RecommendationsRepository,
} from './recommendations.repository';
import { RecommendationDocument } from './schemas/recommendation.schema';
import { AuditService } from '../audit/audit.service';

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
