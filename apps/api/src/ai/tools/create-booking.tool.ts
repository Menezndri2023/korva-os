import {
  createBookingSchema,
  type CreateBookingInput,
} from '@korva/validation';
import { Injectable } from '@nestjs/common';
import type { AiTool } from './tool.interface';
import { BookingsService } from '../../booking/bookings/bookings.service';

@Injectable()
export class CreateBookingTool implements AiTool<CreateBookingInput> {
  readonly definition = {
    name: 'create_booking',
    description:
      'Crée une réservation pour un contact sur une ressource, à un créneau donné (dates ISO 8601).',
    inputSchema: {
      type: 'object',
      properties: {
        resourceId: { type: 'string' },
        offerId: { type: 'string' },
        contactId: { type: 'string' },
        startAt: { type: 'string', description: 'Date/heure ISO 8601' },
        endAt: { type: 'string', description: 'Date/heure ISO 8601' },
        notes: { type: 'string' },
      },
      required: ['resourceId', 'offerId', 'contactId', 'startAt', 'endAt'],
    },
  };
  readonly requiredPermission = 'bookings.create' as const;
  readonly auditEntity = 'booking';

  constructor(private readonly bookingsService: BookingsService) {}

  parseInput(raw: unknown) {
    return createBookingSchema.parse(raw);
  }

  async execute(
    organizationId: string,
    userId: string,
    input: CreateBookingInput,
  ) {
    const booking = await this.bookingsService.create(
      organizationId,
      userId,
      input,
    );
    return {
      id: booking.id as string,
      status: booking.status,
      startAt: booking.startAt,
      endAt: booking.endAt,
    };
  }
}
