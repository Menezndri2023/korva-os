import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { DEAL_STATUSES } from '@korva/types';
import type { AiTool } from './tool.interface';
import { DealsService } from '../../crm/deals/deals.service';

const inputSchema = z.object({
  status: z.enum(DEAL_STATUSES).optional(),
  ownerId: z.string().optional(),
});

@Injectable()
export class SearchDealsTool implements AiTool<z.infer<typeof inputSchema>> {
  readonly definition = {
    name: 'search_deals',
    description:
      'Recherche des affaires (opportunités de vente), avec filtres optionnels par statut ou propriétaire.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: DEAL_STATUSES },
        ownerId: { type: 'string' },
      },
    },
  };
  readonly requiredPermission = 'deals.read' as const;
  readonly auditEntity = 'deal';

  constructor(private readonly dealsService: DealsService) {}

  parseInput(raw: unknown) {
    return inputSchema.parse(raw);
  }

  async execute(
    organizationId: string,
    _userId: string,
    input: z.infer<typeof inputSchema>,
  ) {
    const { data } = await this.dealsService.list(organizationId, {
      page: 1,
      limit: 10,
      status: input.status,
      ownerId: input.ownerId,
    });
    return data.map((deal) => ({
      id: deal.id as string,
      contactId: deal.contactId.toString(),
      status: deal.status,
      estimatedValue: deal.estimatedValue,
      probability: deal.probability,
    }));
  }
}
