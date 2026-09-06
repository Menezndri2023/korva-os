import { z } from 'zod';
import { updateLeadSchema } from '@korva/validation';
import { LEAD_STATUSES } from '@korva/types';
import { Injectable } from '@nestjs/common';
import type { AiTool } from './tool.interface';
import { LeadsService } from '../../crm/leads/leads.service';

const inputSchema = z
  .object({ leadId: z.string().min(1) })
  .and(updateLeadSchema);

@Injectable()
export class UpdateLeadTool implements AiTool<z.infer<typeof inputSchema>> {
  readonly definition = {
    name: 'update_lead',
    description: "Met à jour le statut ou le responsable d'un prospect.",
    inputSchema: {
      type: 'object',
      properties: {
        leadId: { type: 'string' },
        status: { type: 'string', enum: LEAD_STATUSES },
      },
      required: ['leadId'],
    },
  };
  readonly requiredPermission = 'leads.update' as const;
  readonly auditEntity = 'lead';

  constructor(private readonly leadsService: LeadsService) {}

  parseInput(raw: unknown) {
    return inputSchema.parse(raw);
  }

  async execute(
    organizationId: string,
    userId: string,
    input: z.infer<typeof inputSchema>,
  ) {
    const { leadId, ...rest } = input;
    const lead = await this.leadsService.update(
      organizationId,
      userId,
      leadId,
      rest,
    );
    return {
      id: lead.id as string,
      status: lead.status,
    };
  }
}
