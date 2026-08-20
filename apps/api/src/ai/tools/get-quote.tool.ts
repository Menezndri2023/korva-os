import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import type { AiTool } from './tool.interface';
import { QuotesService } from '../../finance/quotes/quotes.service';

const inputSchema = z.object({ quoteId: z.string().min(1) });

@Injectable()
export class GetQuoteTool implements AiTool<z.infer<typeof inputSchema>> {
  readonly definition = {
    name: 'get_quote',
    description: "Récupère les détails d'un devis par son id.",
    inputSchema: {
      type: 'object',
      properties: { quoteId: { type: 'string' } },
      required: ['quoteId'],
    },
  };
  readonly requiredPermission = 'quotes.read' as const;
  readonly auditEntity = 'quote';

  constructor(private readonly quotesService: QuotesService) {}

  parseInput(raw: unknown) {
    return inputSchema.parse(raw);
  }

  async execute(
    organizationId: string,
    _userId: string,
    input: z.infer<typeof inputSchema>,
  ) {
    const quote = await this.quotesService.getById(
      organizationId,
      input.quoteId,
    );
    return {
      id: quote.id as string,
      number: quote.number,
      status: quote.status,
      total: quote.total,
      currency: quote.currency,
      items: quote.items,
    };
  }
}
