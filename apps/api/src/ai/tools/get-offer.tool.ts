import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import type { AiTool } from './tool.interface';
import { OffersService } from '../../catalog/offers/offers.service';

const inputSchema = z.object({ offerId: z.string().min(1) });

@Injectable()
export class GetOfferTool implements AiTool<z.infer<typeof inputSchema>> {
  readonly definition = {
    name: 'get_offer',
    description:
      "Récupère les détails complets d'une offre par son id (prix, description, variantes).",
    inputSchema: {
      type: 'object',
      properties: { offerId: { type: 'string' } },
      required: ['offerId'],
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
    const offer = await this.offersService.getById(
      organizationId,
      input.offerId,
    );
    return {
      id: offer.id as string,
      name: offer.name,
      description: offer.description,
      type: offer.type,
      pricing: offer.pricing,
      variants: offer.variants,
      status: offer.status,
    };
  }
}
