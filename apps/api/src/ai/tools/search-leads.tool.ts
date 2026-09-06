import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { LEAD_STATUSES } from '@korva/types';
import type { AiTool } from './tool.interface';
import { LeadsService } from '../../crm/leads/leads.service';

const inputSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  ownerId: z.string().optional(),
});

@Injectable()
export class SearchLeadsTool implements AiTool<z.infer<typeof inputSchema>> {
  readonly definition = {
    name: 'search_leads',
    description:
      'Recherche des prospects (leads), avec filtres optionnels par statut ou propriétaire.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: LEAD_STATUSES },
        ownerId: { type: 'string' },
      },
    },
  };
  readonly requiredPermission = 'leads.read' as const;
  readonly auditEntity = 'lead';

  constructor(private readonly leadsService: LeadsService) {}

  parseInput(raw: unknown) {
    return inputSchema.parse(raw);
  }

  async execute(
    organizationId: string,
    _userId: string,
    input: z.infer<typeof inputSchema>,
  ) {
    const { data } = await this.leadsService.list(organizationId, {
      page: 1,
      limit: 10,
      status: input.status,
      ownerId: input.ownerId,
    });
    return data.map((lead) => ({
      id: lead.id as string,
      contactId: lead.contactId.toString(),
      status: lead.status,
    }));
  }
}
