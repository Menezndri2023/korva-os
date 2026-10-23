import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { OFFER_TYPES } from '@korva/types';
import type { AiTool } from './tool.interface';
import { OffersService } from '../../catalog/offers/offers.service';

const inputSchema = z.object({
  search: z.string().optional(),
  type: z.enum(OFFER_TYPES).optional(),
});

@Injectable()
export class SearchOffersTool implements AiTool<z.infer<typeof inputSchema>> {
  readonly definition = {
    name: 'search_offers',
    description:
      "Cherche dans le catalogue (produits, prestations, chambres, formations, biens…). Sans paramètre : tout le catalogue. search : un mot du nom. type ne sert qu'à restreindre ; en cas de doute, ne le donne pas.",
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        type: { type: 'string', enum: OFFER_TYPES },
      },
    },
  };
  readonly requiredPermission = 'offers.read' as const;
  readonly auditEntity = 'offer';

  constructor(private readonly offersService: OffersService) {}

  parseInput(raw: unknown) {
    return inputSchema.parse(raw);
  }

  async execute(
    organizationId: string,
    _userId: string,
    input: z.infer<typeof inputSchema>,
  ) {
    const { data } = await this.offersService.list(organizationId, {
      page: 1,
      limit: 10,
      sort: 'newest',
      search: input.search,
      type: input.type,
    });
    return data.map((offer) => ({
      id: offer.id as string,
      name: offer.name,
      type: offer.type,
      pricing: offer.pricing,
      status: offer.status,
      trackStock: offer.trackStock,
      stockOnHand: offer.stockOnHand,
    }));
  }
}
