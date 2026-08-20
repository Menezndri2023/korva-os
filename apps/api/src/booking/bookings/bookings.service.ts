import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type {
  CreateBookingInput,
  ListBookingsQuery,
  RescheduleBookingInput,
  UpdateBookingInput,
} from '@korva/validation';
import type { Pagination } from '@korva/types';
import { BookingsRepository } from './bookings.repository';
import { BookingDocument } from './schemas/booking.schema';
import { AvailabilityService } from '../availability/availability.service';
import { ContactsService } from '../../crm/contacts/contacts.service';
import { OffersService } from '../../catalog/offers/offers.service';
import { AuditService } from '../../audit/audit.service';
import { EventBusService } from '../../core/events/event-bus.service';

@Injectable()
export class BookingsService {
  constructor(
    private readonly bookingsRepository: BookingsRepository,
    private readonly availabilityService: AvailabilityService,
    private readonly contactsService: ContactsService,
    private readonly offersService: OffersService,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBusService,
  ) {}

  async create(
    organizationId: string,
    userId: string,
    input: CreateBookingInput,
  ): Promise<BookingDocument> {
    const contactExists = await this.contactsService.existsById(
      organizationId,
      input.contactId,
    );
    if (!contactExists) {
      throw new NotFoundException({
        code: 'CONTACT_NOT_FOUND',
        message: 'Contact not found',
      });
    }
    const offer = await this.offersService.getById(
      organizationId,
      input.offerId,
    );

    const startAt = new Date(input.startAt);
    const endAt = new Date(input.endAt);
    await this.availabilityService.assertSlotAvailable(
      organizationId,
      input.resourceId,
      startAt,
      endAt,
    );

    const booking = await this.bookingsRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      resourceId: new Types.ObjectId(input.resourceId),
      offerId: new Types.ObjectId(input.offerId),
      contactId: new Types.ObjectId(input.contactId),
      startAt,
      endAt,
      pricing: {
        amount: offer.pricing.amount,
        currency: offer.pricing.currency,
      },
      notes: input.notes,
    });

    await this.auditService.record({
      organizationId,
      userId,
      action: 'BOOKING',
      entity: 'booking',
      entityId: booking.id as string,
    });

    await this.eventBus.publish(organizationId, 'booking.created', {
      bookingId: booking.id as string,
      resourceId: input.resourceId,
      contactId: input.contactId,
      startAt: input.startAt,
    });

    return booking;
  }

  async getById(organizationId: string, id: string): Promise<BookingDocument> {
    const booking = await this.bookingsRepository.findById(organizationId, id);
    if (!booking) {
      throw new NotFoundException({
        code: 'BOOKING_NOT_FOUND',
        message: 'Booking not found',
      });
    }
    return booking;
  }

  async list(
    organizationId: string,
    query: ListBookingsQuery,
  ): Promise<{ data: BookingDocument[]; pagination: Pagination }> {
    const { data, total } = await this.bookingsRepository.findAll(
      organizationId,
      query,
    );
    return {
      data,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  async update(
    organizationId: string,
    userId: string,
    id: string,
    input: UpdateBookingInput,
  ): Promise<BookingDocument> {
    const updated = await this.bookingsRepository.update(organizationId, id, {
      notes: input.notes,
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'BOOKING_NOT_FOUND',
        message: 'Booking not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'booking',
      entityId: id,
    });

    return updated;
  }

  async reschedule(
    organizationId: string,
    userId: string,
    id: string,
    input: RescheduleBookingInput,
  ): Promise<BookingDocument> {
    const booking = await this.getById(organizationId, id);
    if (booking.status === 'cancelled' || booking.status === 'completed') {
      throw new BadRequestException({
        code: 'BOOKING_NOT_RESCHEDULABLE',
        message: `Cannot reschedule a booking with status "${booking.status}"`,
      });
    }

    const startAt = new Date(input.startAt);
    const endAt = new Date(input.endAt);
    await this.availabilityService.assertSlotAvailable(
      organizationId,
      booking.resourceId.toString(),
      startAt,
      endAt,
      id,
    );

    const updated = await this.bookingsRepository.update(organizationId, id, {
      startAt,
      endAt,
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'BOOKING_NOT_FOUND',
        message: 'Booking not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'booking',
      entityId: id,
      metadata: { rescheduled: true },
    });

    return updated;
  }

  async cancel(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<BookingDocument> {
    const booking = await this.getById(organizationId, id);
    if (booking.status === 'cancelled') {
      throw new BadRequestException({
        code: 'BOOKING_ALREADY_CANCELLED',
        message: 'This booking is already cancelled',
      });
    }
    if (booking.status === 'completed') {
      throw new BadRequestException({
        code: 'BOOKING_NOT_CANCELLABLE',
        message: 'Cannot cancel a completed booking',
      });
    }

    const updated = await this.bookingsRepository.update(organizationId, id, {
      status: 'cancelled',
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'BOOKING_NOT_FOUND',
        message: 'Booking not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'booking',
      entityId: id,
      metadata: { status: 'cancelled' },
    });

    await this.eventBus.publish(organizationId, 'booking.cancelled', {
      bookingId: id,
      resourceId: updated.resourceId.toString(),
      contactId: updated.contactId.toString(),
    });

    return updated;
  }
}
