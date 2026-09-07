import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import type { AiTool } from './tool.interface';
import { AnalyticsService } from '../../analytics/analytics.service';

const inputSchema = z.object({});

/**
 * Phase C4 (docs/KORVA_OS_V2_AUDIT.md §2.4) — the first Inventory AI tool. `suggestedQuantity`
 * is a simple heuristic (recent sales velocity, or enough to refill to the reorder point,
 * whichever is larger) — never a demand forecast, same "no LLM standing in for a business
 * decision" philosophy as the Decision Engine's own rules. Not `sensitive`: this only ever
 * surfaces a suggestion, it never creates a purchase order itself.
 */
@Injectable()
export class SuggestReorderTool implements AiTool<z.infer<typeof inputSchema>> {
  readonly definition = {
    name: 'suggest_reorder',
    description:
      "Liste les offres dont le stock est au niveau (ou en dessous) de leur seuil d'alerte, avec une quantité de réapprovisionnement suggérée.",
    inputSchema: { type: 'object', properties: {} },
  };
  readonly requiredPermission = 'analytics.read' as const;
  readonly auditEntity = 'offer';

  constructor(private readonly analyticsService: AnalyticsService) {}

  parseInput(raw: unknown) {
    return inputSchema.parse(raw);
  }

  execute(organizationId: string) {
    return this.analyticsService.getReorderSuggestions(organizationId);
  }
}
