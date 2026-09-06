import { z } from 'zod';
import { loseDealSchema } from '@korva/validation';
import { Injectable } from '@nestjs/common';
import type { AiTool } from './tool.interface';
import { DealsService } from '../../crm/deals/deals.service';

const inputSchema = z.object({ dealId: z.string().min(1) }).and(loseDealSchema);

/**
 * Sensitive: losing a deal forecloses tracked revenue — a business-outcome decision, not
 * incidental metadata. See win-deal.tool.ts's doc comment for the full rationale (both tools are
 * deliberately tightened relative to today's non-sensitive update_lead status flip).
 */
@Injectable()
export class LoseDealTool implements AiTool<z.infer<typeof inputSchema>> {
  readonly definition = {
    name: 'lose_deal',
    description:
      'Marque une affaire comme perdue, avec une raison optionnelle. Nécessite une confirmation humaine.',
    inputSchema: {
      type: 'object',
      properties: {
        dealId: { type: 'string' },
        lossReason: { type: 'string' },
      },
      required: ['dealId'],
    },
  };
  readonly requiredPermission = 'deals.update' as const;
  readonly sensitive = true;
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
    const { dealId, ...rest } = input;
    const deal = await this.dealsService.lose(
      organizationId,
      userId,
      dealId,
      rest,
    );
    return { id: deal.id as string, status: deal.status };
  }
}
