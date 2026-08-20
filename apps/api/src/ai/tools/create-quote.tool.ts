import { createQuoteSchema, type CreateQuoteInput } from '@korva/validation';
import { Injectable } from '@nestjs/common';
import type { AiTool } from './tool.interface';
import { QuotesService } from '../../finance/quotes/quotes.service';

@Injectable()
export class CreateQuoteTool implements AiTool<CreateQuoteInput> {
  readonly definition = {
    name: 'create_quote',
    description:
      'Crée un devis pour un contact, avec une ou plusieurs lignes (description, quantité, prix unitaire).',
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              offerId: { type: 'string' },
              description: { type: 'string' },
              quantity: { type: 'number' },
              unitPrice: { type: 'number' },
              taxRate: { type: 'number' },
            },
            required: ['description', 'quantity', 'unitPrice'],
          },
        },
        currency: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['contactId', 'items', 'currency'],
    },
  };
  readonly requiredPermission = 'quotes.create' as const;
  readonly auditEntity = 'quote';

  constructor(private readonly quotesService: QuotesService) {}

  parseInput(raw: unknown) {
    return createQuoteSchema.parse(raw);
  }

  async execute(
    organizationId: string,
    userId: string,
    input: CreateQuoteInput,
  ) {
    const quote = await this.quotesService.create(
      organizationId,
      userId,
      input,
    );
    return {
      id: quote.id as string,
      number: quote.number,
      total: quote.total,
      status: quote.status,
    };
  }
}
