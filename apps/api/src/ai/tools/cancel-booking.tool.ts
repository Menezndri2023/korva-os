import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import type { AiTool } from './tool.interface';
import { BookingsService } from '../../booking/bookings/bookings.service';

const inputSchema = z.object({ bookingId: z.string().min(1) });

/** Sensitive: mirrors "cancel_large_booking" from docs/ai.md — every cancellation requires human confirmation in this MVP. */
@Injectable()
export class CancelBookingTool implements AiTool<z.infer<typeof inputSchema>> {
  readonly definition = {
    name: 'cancel_booking',
    description:
      'Annule une réservation existante. Nécessite une confirmation humaine.',
    inputSchema: {
      type: 'object',
      properties: { bookingId: { type: 'string' } },
      required: ['bookingId'],
    },
  };
  readonly requiredPermission = 'bookings.cancel' as const;
  readonly sensitive = true;
  readonly auditEntity = 'booking';

  constructor(private readonly bookingsService: BookingsService) {}

  parseInput(raw: unknown) {
    return inputSchema.parse(raw);
  }

  async execute(
    organizationId: string,
    userId: string,
    input: z.infer<typeof inputSchema>,
  ) {
    const booking = await this.bookingsService.cancel(
      organizationId,
      userId,
      input.bookingId,
      'business',
    );
    return { id: booking.id as string, status: booking.status };
  }
}
