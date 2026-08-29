import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import type { AiTool } from './tool.interface';
import { RecommendationsService } from '../../decision-engine/recommendations.service';

const inputSchema = z.object({ recommendationId: z.string().min(1) });

/** Not sensitive, same rationale as DismissRecommendationTool — marking a recommendation
 *  resolved records that a human already handled it outside KORVA; it triggers no downstream
 *  action on its own. */
@Injectable()
export class ResolveRecommendationTool implements AiTool<
  z.infer<typeof inputSchema>
> {
  readonly definition = {
    name: 'resolve_recommendation',
    description: 'Marque une recommandation ouverte de KORVA comme résolue.',
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
    const recommendation = await this.recommendationsService.resolve(
      organizationId,
      userId,
      input.recommendationId,
    );
    return { id: recommendation.id as string, status: recommendation.status };
  }
}
