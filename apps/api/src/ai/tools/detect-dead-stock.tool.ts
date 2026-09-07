import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import type { AiTool } from './tool.interface';
import { AnalyticsService } from '../../analytics/analytics.service';

const inputSchema = z.object({
  days: z.number().int().min(1).max(365).optional(),
});

/** Phase C4 — tracked offers that still have stock but haven't recorded a single `sold`
 *  movement within the lookback window (default 90 days, see AnalyticsService.getDeadStock). */
@Injectable()
export class DetectDeadStockTool implements AiTool<
  z.infer<typeof inputSchema>
> {
  readonly definition = {
    name: 'detect_dead_stock',
    description:
      "Liste les offres suivies en stock qui n'ont fait l'objet d'aucune vente récente (stock dormant).",
    inputSchema: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: "Fenêtre d'observation en jours (par défaut 90).",
        },
      },
    },
  };
  readonly requiredPermission = 'analytics.read' as const;
  readonly auditEntity = 'offer';

  constructor(private readonly analyticsService: AnalyticsService) {}

  parseInput(raw: unknown) {
    return inputSchema.parse(raw);
  }

  execute(
    organizationId: string,
    _userId: string,
    input: z.infer<typeof inputSchema>,
  ) {
    return this.analyticsService.getDeadStock(organizationId, input.days ?? 90);
  }
}
