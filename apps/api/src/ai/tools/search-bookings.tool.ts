import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { BOOKING_STATUSES } from '@korva/types';
import type { AiTool } from './tool.interface';
import { BookingsService } from '../../booking/bookings/bookings.service';
import { OffersService } from '../../catalog/offers/offers.service';
import { OrganizationsService } from '../../organizations/organizations.service';
import { localDateTimeToUtcIso, utcToLocalLabel } from './local-datetime';

const inputSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(BOOKING_STATUSES).optional(),
  contactId: z.string().optional(),
});
type Input = z.infer<typeof inputSchema>;

/** The business's appointments, stays or sessions between two days (local dates, both
 *  included). Before it, "quels rendez-vous ai-je cette semaine ?" could only be answered by
 *  probing availability day by day — and ran out of steps. */
@Injectable()
export class SearchBookingsTool implements AiTool<Input> {
  readonly definition = {
    name: 'search_bookings',
    description:
      'Liste les réservations (rendez-vous, séjours, séances) entre deux jours inclus, dates locales AAAA-MM-JJ. Pour « cette semaine », du lundi au dimanche de la semaine en cours.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Premier jour, AAAA-MM-JJ' },
        to: { type: 'string', description: 'Dernier jour inclus, AAAA-MM-JJ' },
        status: { type: 'string', enum: [...BOOKING_STATUSES] },
        contactId: { type: 'string' },
      },
      required: ['from', 'to'],
    },
  };
  readonly requiredPermission = 'bookings.read' as const;
  readonly auditEntity = 'booking';

  constructor(
    private readonly bookingsService: BookingsService,
    private readonly offersService: OffersService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  parseInput(raw: unknown) {
    return inputSchema.parse(raw);
  }

  async execute(organizationId: string, _userId: string, input: Input) {
    const { timezone } =
      await this.organizationsService.getById(organizationId);
    const { data, pagination } = await this.bookingsService.list(
      organizationId,
      {
        page: 1,
        limit: 50,
        status: input.status,
        contactId: input.contactId,
        from: localDateTimeToUtcIso(`${input.from}T00:00`, timezone),
        to: localDateTimeToUtcIso(`${input.to}T23:59`, timezone),
      },
    );
    const offerNames = new Map<string, string>();
    for (const id of new Set(
      data.map((booking) => booking.offerId.toString()),
    )) {
      const offer = await this.offersService
        .getById(organizationId, id)
        .catch(() => null);
      if (offer) offerNames.set(id, offer.name);
    }
    return {
      total: pagination.total,
      bookings: data.map((booking) => ({
        id: booking.id as string,
        status: booking.status,
        offer: offerNames.get(booking.offerId.toString()),
        contactId: booking.contactId.toString(),
        startsAt: utcToLocalLabel(booking.startAt, timezone),
        endsAt: utcToLocalLabel(booking.endAt, timezone),
      })),
    };
  }
}
