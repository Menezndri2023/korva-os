import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import type { AiTool } from './tool.interface';
import { DealsService } from '../../crm/deals/deals.service';

const inputSchema = z.object({ dealId: z.string().min(1) });

/**
 * Sensitive: winning a deal marks a real business-outcome decision — the sales revenue it
 * represents becomes tracked as closed/won — the same "engagements financiers" category
 * create-order.tool.ts's own doc comment reasons about for orders (docs/BUSINESS_OS_AUDIT.md
 * §6). Deliberately tightened relative to today's non-sensitive update_lead status flip: since
 * this is a brand-new tool there's no regression cost to setting the bar correctly from the start.
 */
@Injectable()
export class WinDealTool implements AiTool<z.infer<typeof inputSchema>> {
  readonly definition = {
    name: 'win_deal',
    description:
      'Marque une affaire comme gagnée. Nécessite une confirmation humaine.',
    inputSchema: {
      type: 'object',
      properties: { dealId: { type: 'string' } },
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
    const deal = await this.dealsService.win(
      organizationId,
      userId,
      input.dealId,
    );
    return { id: deal.id as string, status: deal.status };
  }
}
