import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { QUOTE_STATUSES } from '@korva/types';
import type { AiTool } from './tool.interface';
import { QuotesService } from '../../finance/quotes/quotes.service';

const inputSchema = z.object({
  status: z.enum(QUOTE_STATUSES).optional(),
  contactId: z.string().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

/** The quotes of the business — most recent first, optionally by status or client. get_quote
 *  only reads one by id, so "which quotes are still waiting?" had no answer before. */
@Injectable()
export class SearchQuotesTool implements AiTool<z.infer<typeof inputSchema>> {
  readonly definition = {
    name: 'search_quotes',
    description:
      'Liste les devis, les plus récents en premier. status : draft (brouillon), sent (envoyé), viewed (consulté), accepted, rejected, expired. Un devis « en attente de réponse » est sent ou viewed ; un brouillon n’a pas encore été envoyé.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: [...QUOTE_STATUSES] },
        contactId: { type: 'string' },
        limit: { type: 'number', description: '20 par défaut' },
      },
    },
  };
  readonly requiredPermission = 'quotes.read' as const;
  readonly auditEntity = 'quote';

  constructor(private readonly quotesService: QuotesService) {}

  parseInput(raw: unknown) {
    return inputSchema.parse(raw ?? {});
  }

  async execute(
    organizationId: string,
    _userId: string,
    input: z.infer<typeof inputSchema>,
  ) {
    const { data, pagination } = await this.quotesService.list(organizationId, {
      page: 1,
      limit: input.limit ?? 20,
      status: input.status,
      contactId: input.contactId,
    });
    return {
      total: pagination.total,
      quotes: data.map((quote) => ({
        id: quote.id as string,
        number: quote.number,
        status: quote.status,
        total: quote.total,
        currency: quote.currency,
        contactId: quote.contactId.toString(),
        validUntil: quote.validUntil,
        createdAt: (quote as unknown as { createdAt: Date }).createdAt,
      })),
    };
  }
}
