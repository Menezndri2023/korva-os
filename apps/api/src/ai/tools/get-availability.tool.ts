import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import type { AiTool } from './tool.interface';
import { AvailabilityService } from '../../booking/availability/availability.service';

const inputSchema = z.object({
  resourceId: z.string().min(1),
  date: z.string().min(1),
});

@Injectable()
export class GetAvailabilityTool implements AiTool<
  z.infer<typeof inputSchema>
> {
  readonly definition = {
    name: 'get_availability',
    description:
      "Consulte les créneaux disponibles d'une ressource pour une date donnée (YYYY-MM-DD).",
    inputSchema: {
      type: 'object',
      properties: {
        resourceId: { type: 'string' },
        date: { type: 'string', description: 'Date au format YYYY-MM-DD' },
      },
      required: ['resourceId', 'date'],
    },
  };
  readonly requiredPermission = 'bookings.read' as const;
  readonly auditEntity = 'availability';

  constructor(private readonly availabilityService: AvailabilityService) {}

  parseInput(raw: unknown) {
    return inputSchema.parse(raw);
  }

  execute(
    organizationId: string,
    _userId: string,
    input: z.infer<typeof inputSchema>,
  ) {
    return this.availabilityService.getDayAvailability(
      organizationId,
      input.resourceId,
      input.date,
    );
  }
}
