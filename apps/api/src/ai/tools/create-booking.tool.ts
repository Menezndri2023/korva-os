import { z } from 'zod';
import { createBookingSchema } from '@korva/validation';
import { Injectable } from '@nestjs/common';
import type { AiTool } from './tool.interface';
import { BookingsService } from '../../booking/bookings/bookings.service';
import { OffersService } from '../../catalog/offers/offers.service';
import { OrganizationsService } from '../../organizations/organizations.service';
import { localDateTimeToUtcIso, utcToLocalLabel } from './local-datetime';

const inputSchema = z.object({
  resourceId: z.string().min(1),
  offerId: z.string().min(1),
  contactId: z.string().min(1),
  startAt: z.string().min(1),
  endAt: z.string().min(1).optional(),
  notes: z.string().max(2000).optional(),
});
type Input = z.infer<typeof inputSchema>;

/** Times are the business's local time; the end defaults to the service's own duration. */
@Injectable()
export class CreateBookingTool implements AiTool<Input> {
  readonly definition = {
    name: 'create_booking',
    description:
      "Crée une réservation pour un contact. Heures en heure locale de l'entreprise, format AAAA-MM-JJTHH:mm (ex. 2026-10-26T14:00). endAt est facultatif : par défaut, la durée de la prestation. resourceId vient de list_resources, offerId de search_offers, contactId de search_contacts ; vérifie d'abord le créneau avec get_availability.",
    inputSchema: {
      type: 'object',
      properties: {
        resourceId: {
          type: 'string',
          description: 'Un id renvoyé par list_resources',
        },
        offerId: {
          type: 'string',
          description: 'Un id renvoyé par search_offers',
        },
        contactId: {
          type: 'string',
          description: 'Un id renvoyé par search_contacts',
        },
        startAt: {
          type: 'string',
          description: 'Heure locale, ex. 2026-10-26T14:00',
        },
        endAt: { type: 'string', description: 'Facultatif, heure locale' },
        notes: { type: 'string' },
      },
      required: ['resourceId', 'offerId', 'contactId', 'startAt'],
    },
  };
  readonly requiredPermission = 'bookings.create' as const;
  readonly auditEntity = 'booking';

  constructor(
    private readonly bookingsService: BookingsService,
    private readonly offersService: OffersService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  parseInput(raw: unknown) {
    return inputSchema.parse(raw);
  }

  async execute(organizationId: string, userId: string, input: Input) {
    const organization =
      await this.organizationsService.getById(organizationId);
    const timeZone = organization.timezone;
    const startAt = localDateTimeToUtcIso(input.startAt, timeZone);
    let endAt: string;
    if (input.endAt) {
      endAt = localDateTimeToUtcIso(input.endAt, timeZone);
    } else {
      const offer = await this.offersService.getById(
        organizationId,
        input.offerId,
      );
      const minutes = offer.durationMinutes ?? 60;
      endAt = new Date(
        new Date(startAt).getTime() + minutes * 60_000,
      ).toISOString();
    }
    const booking = await this.bookingsService.create(
      organizationId,
      userId,
      createBookingSchema.parse({ ...input, startAt, endAt }),
    );
    return {
      id: booking.id as string,
      status: booking.status,
      startsAt: utcToLocalLabel(booking.startAt, timeZone),
      endsAt: utcToLocalLabel(booking.endAt, timeZone),
    };
  }
}
