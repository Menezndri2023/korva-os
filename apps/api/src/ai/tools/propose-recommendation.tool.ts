import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { RECOMMENDATION_ENTITY_TYPES } from '@korva/types';
import type { AiTool } from './tool.interface';
import { RecommendationsService } from '../../decision-engine/recommendations.service';

const inputSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  entityType: z.enum(RECOMMENDATION_ENTITY_TYPES),
  entityId: z.string().min(1),
});

/**
 * Lets the AI DRAFT a recommendation instead of only reading the Decision Engine's own output
 * (list_recommendations) — the piece of "AI plus autonome" this tool exists for: the AI can now
 * surface something it noticed on its own (while answering a staff question, running a report,
 * etc.), but never acts on it. Deliberately not `sensitive`: unlike cancel_booking/create_order,
 * writing an open Recommendation touches no customer and commits the organization to nothing —
 * it only ever adds a row to a queue a human must still explicitly resolve/dismiss (same
 * dismiss_recommendation/resolve_recommendation tools, or the dashboard UI). See
 * RecommendationsService.propose for why entityId is trusted for shape only, not existence.
 */
@Injectable()
export class ProposeRecommendationTool implements AiTool<
  z.infer<typeof inputSchema>
> {
  readonly definition = {
    name: 'propose_recommendation',
    description:
      "Propose une nouvelle recommandation pour l'équipe (ex: \"ce client mérite une relance\"), basée UNIQUEMENT sur des données déjà obtenues via d'autres outils (jamais une supposition). La recommandation reste en attente : un humain doit la résoudre ou l'ignorer depuis le tableau de bord — cet outil ne déclenche jamais d'action lui-même.",
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        entityType: { type: 'string', enum: RECOMMENDATION_ENTITY_TYPES },
        entityId: {
          type: 'string',
          description:
            "L'identifiant réel de l'invoice/contact/offer concerné, obtenu via un autre outil (ex: get_customer, get_invoice) — jamais inventé.",
        },
      },
      required: ['title', 'description', 'entityType', 'entityId'],
    },
  };
  readonly requiredPermission = 'recommendations.create' as const;
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
    const recommendation = await this.recommendationsService.propose(
      organizationId,
      input,
    );
    return {
      id: recommendation.id as string,
      status: recommendation.status,
    };
  }
}
