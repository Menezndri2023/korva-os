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
      "Consulte les créneaux disponibles d'une ressource pour une date donnée (YYYY-MM-DD). resourceId vient de list_resources.",
    inputSchema: {
      type: 'object',
      properties: {
        resourceId: {
          type: 'string',
          description: 'Un id renvoyé par list_resources',
        },
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

  async execute(
    organizationId: string,
    _userId: string,
    input: z.infer<typeof inputSchema>,
  ) {
    const availability = await this.availabilityService.getDayAvailability(
      organizationId,
      input.resourceId,
      input.date,
    );
    // Spelled out for the model: the weekday of the date asked (computed, not guessed) and
    // whether the place is simply closed that day.
    return {
      weekday: new Intl.DateTimeFormat('fr-FR', {
        weekday: 'long',
        timeZone: 'UTC',
      }).format(new Date(`${input.date}T12:00:00Z`)),
      closed: availability.windows.length === 0,
      ...availability,
    };
  }
}
