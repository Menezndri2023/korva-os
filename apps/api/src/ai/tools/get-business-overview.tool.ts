import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import type { ActionCenterSeverity } from '@korva/types';
import type { AiTool } from './tool.interface';
import { BusinessGraphService } from '../../business-graph/business-graph.service';
import { ActionCenterService } from '../../action-center/action-center.service';

const inputSchema = z.object({});

const SEVERITY_RANK: Record<ActionCenterSeverity, number> = {
  urgent: 0,
  attention: 1,
  opportunity: 2,
  recommendation: 3,
};

const TOP_ITEMS_LIMIT = 10;

/**
 * Phase F2 (docs/KORVA_OS_V2_AUDIT.md §2.7) — the first tool that reasons across products
 * instead of reading one module's data, closing the gap the audit itself flagged: "nothing
 * answers 'what needs my attention today' / 'why is revenue down' by reasoning across
 * products." Combines the Business Graph's org-level summary (F1 — real CRM/Finance/Inventory/
 * Supplier counts, never an estimate) with the Action Center's own severity-ranked feed
 * (Phase B), so those questions get a grounded, cross-product answer instead of only ever
 * reading one module's recommendation list (list_recommendations' own scope).
 */
@Injectable()
export class GetBusinessOverviewTool implements AiTool<
  z.infer<typeof inputSchema>
> {
  readonly definition = {
    name: 'get_business_overview',
    description:
      "Vue d'ensemble de l'activité tous produits confondus : chiffres clés CRM/Finance/Stock/Fournisseurs, et les éléments les plus urgents nécessitant une attention (factures en retard, stock bas, échecs d'automatisation...). Utile pour répondre à des questions comme \"qu'est-ce qui a besoin de mon attention aujourd'hui ?\" ou \"comment va mon activité ?\".",
    inputSchema: { type: 'object', properties: {} },
  };
  readonly requiredPermission = 'analytics.read' as const;
  readonly auditEntity = 'organization';

  constructor(
    private readonly businessGraphService: BusinessGraphService,
    private readonly actionCenterService: ActionCenterService,
  ) {}

  parseInput(raw: unknown) {
    return inputSchema.parse(raw);
  }

  async execute(organizationId: string) {
    const [summary, feed] = await Promise.all([
      this.businessGraphService.getOrganizationSummary(organizationId),
      this.actionCenterService.getFeed(organizationId),
    ]);

    const topPriorityItems = [...feed]
      .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
      .slice(0, TOP_ITEMS_LIMIT)
      .map((item) => ({
        type: item.type,
        title: item.title,
        severity: item.severity,
        impact: item.impact,
      }));

    return { summary, topPriorityItems };
  }
}
