import { createDealSchema, type CreateDealInput } from '@korva/validation';
import { Injectable } from '@nestjs/common';
import type { AiTool } from './tool.interface';
import { DealsService } from '../../crm/deals/deals.service';

@Injectable()
export class CreateDealTool implements AiTool<CreateDealInput> {
  readonly definition = {
    name: 'create_deal',
    description:
      'Crée une affaire (opportunité de vente) pour un contact, dans un pipeline et une étape donnés.',
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'string' },
        pipelineId: { type: 'string' },
        stageId: { type: 'string' },
        ownerId: { type: 'string' },
        estimatedValue: { type: 'number' },
        probability: { type: 'number' },
      },
      required: ['contactId', 'pipelineId', 'stageId'],
    },
  };
  readonly requiredPermission = 'deals.create' as const;
  readonly auditEntity = 'deal';

  constructor(private readonly dealsService: DealsService) {}

  parseInput(raw: unknown) {
    return createDealSchema.parse(raw);
  }

  async execute(
    organizationId: string,
    userId: string,
    input: CreateDealInput,
  ) {
    const deal = await this.dealsService.create(organizationId, userId, input);
    return {
      id: deal.id as string,
      status: deal.status,
      estimatedValue: deal.estimatedValue,
    };
  }
}
