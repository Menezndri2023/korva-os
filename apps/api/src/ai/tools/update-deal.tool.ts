import { z } from 'zod';
import { updateDealSchema } from '@korva/validation';
import { Injectable } from '@nestjs/common';
import type { AiTool } from './tool.interface';
import { DealsService } from '../../crm/deals/deals.service';

const inputSchema = z
  .object({ dealId: z.string().min(1), stageId: z.string().min(1).optional() })
  .and(updateDealSchema);

@Injectable()
export class UpdateDealTool implements AiTool<z.infer<typeof inputSchema>> {
  readonly definition = {
    name: 'update_deal',
    description:
      "Met à jour le responsable, la valeur, la probabilité ou l'étape d'une affaire.",
    inputSchema: {
      type: 'object',
      properties: {
        dealId: { type: 'string' },
        stageId: { type: 'string' },
        ownerId: { type: 'string' },
        estimatedValue: { type: 'number' },
        probability: { type: 'number' },
      },
      required: ['dealId'],
    },
  };
  readonly requiredPermission = 'deals.update' as const;
  readonly auditEntity = 'deal';

  constructor(private readonly dealsService: DealsService) {}

  parseInput(raw: unknown) {
    return inputSchema.parse(raw);
  }

  async execute(
    organizationId: string,
    userId: string,
    input: z.infer<typeof inputSchema>,
  ) {
    const { dealId, stageId, ...rest } = input;

    if (stageId) {
      await this.dealsService.moveStage(organizationId, userId, dealId, {
        stageId,
      });
    }

    const deal = await this.dealsService.update(
      organizationId,
      userId,
      dealId,
      rest,
    );

    return {
      id: deal.id as string,
      stageId: deal.stageId.toString(),
      status: deal.status,
      estimatedValue: deal.estimatedValue,
    };
  }
}
