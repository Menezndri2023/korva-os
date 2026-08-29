import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { RECOMMENDATION_STATUSES } from '@korva/types';
import type { AiTool } from './tool.interface';
import { RecommendationsService } from '../../decision-engine/recommendations.service';

const inputSchema = z.object({
  status: z.enum(RECOMMENDATION_STATUSES).optional(),
});

/**
 * Gives the assistant read access to the Decision Engine's own output — "quels clients dois-je
 * relancer ?" (Business OS brief §18) should be answered from real Recommendation rows, never
 * hallucinated. The rules that produce these stay deterministic (decision-engine/rules/*); this
 * tool only ever reads what they already decided, consistent with the brief's AI autonomy
 * levels 1-2 (observer/analyst) — it does not let the AI invent a new recommendation.
 */
@Injectable()
export class ListRecommendationsTool implements AiTool<
  z.infer<typeof inputSchema>
> {
  readonly definition = {
    name: 'list_recommendations',
    description:
      'Liste les recommandations de KORVA (ex: facture en retard, client inactif), avec filtre optionnel par statut (open/dismissed/resolved). Par défaut affiche les recommandations ouvertes.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: RECOMMENDATION_STATUSES },
      },
    },
  };
  readonly requiredPermission = 'recommendations.read' as const;
  readonly auditEntity = 'recommendation';

  constructor(
    private readonly recommendationsService: RecommendationsService,
  ) {}

  parseInput(raw: unknown) {
    return inputSchema.parse(raw);
  }

  async execute(
    organizationId: string,
    _userId: string,
    input: z.infer<typeof inputSchema>,
  ) {
    const { data } = await this.recommendationsService.list(organizationId, {
      page: 1,
      limit: 10,
      status: input.status ?? 'open',
    });
    return data.map((recommendation) => ({
      id: recommendation.id as string,
      ruleKey: recommendation.ruleKey,
      title: recommendation.title,
      description: recommendation.description,
      entityType: recommendation.entityType,
      entityId: recommendation.entityId.toString(),
      status: recommendation.status,
    }));
  }
}
