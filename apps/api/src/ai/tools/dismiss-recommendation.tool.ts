import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import type { AiTool } from './tool.interface';
import { RecommendationsService } from '../../decision-engine/recommendations.service';

const inputSchema = z.object({ recommendationId: z.string().min(1) });

/** Not sensitive: dismissing a recommendation only marks it as ignored (RECOMMENDATION_INVALID_TRANSITION
 *  guards against touching anything but an open one) — there is nothing destructive or financial
 *  to confirm, unlike cancel_booking. */
@Injectable()
export class DismissRecommendationTool implements AiTool<
  z.infer<typeof inputSchema>
> {
  readonly definition = {
    name: 'dismiss_recommendation',
    description: 'Ignore une recommandation ouverte de KORVA.',
    inputSchema: {
      type: 'object',
      properties: { recommendationId: { type: 'string' } },
      required: ['recommendationId'],
    },
  };
  readonly requiredPermission = 'recommendations.update' as const;
  readonly auditEntity = 'recommendation';

  constructor(
    private readonly recommendationsService: RecommendationsService,
  ) {}

  parseInput(raw: unknown) {
    return inputSchema.parse(raw);
  }

  async execute(
    organizationId: string,
    userId: string,
    input: z.infer<typeof inputSchema>,
  ) {
    const recommendation = await this.recommendationsService.dismiss(
      organizationId,
      userId,
      input.recommendationId,
    );
    return { id: recommendation.id as string, status: recommendation.status };
  }
}
