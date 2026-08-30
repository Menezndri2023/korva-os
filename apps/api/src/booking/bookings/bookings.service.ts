import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import type {
  CompleteBookingInput,
  CreateBookingInput,
  ListBookingsQuery,
  RescheduleBookingInput,
  UpdateBookingInput,
} from '@korva/validation';
import type { BookingPaymentStatus, Pagination } from '@korva/types';
import { BookingsRepository } from './bookings.repository';
import { BookingDocument } from './schemas/booking.schema';
import { AvailabilityService } from '../availability/availability.service';
import { ContactsService } from '../../crm/contacts/contacts.service';
import { OffersService } from '../../catalog/offers/offers.service';
import { AuditService } from '../../audit/audit.service';
import { EventBusService } from '../../core/events/event-bus.service';
import { ConversationsService } from '../../communication/conversations/conversations.service';
import { sendWithChannelFallback } from '../../communication/notify-contact-with-fallback';
import { interpolate } from '../../shared/template';

const COMPLETION_MESSAGE =
  'Bonjour {{contact.firstName}}, félicitations pour avoir terminé la formation « {{offer.name}} » ! Merci pour votre participation.';

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly bookingsRepository: BookingsRepository,
    private readonly availabilityService: AvailabilityService,
    private readonly contactsService: ContactsService,
    private readonly offersService: OffersService,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBusService,
    private readonly conversationsService: ConversationsService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async create(
    organizationId: string,
    userId: string | undefined,
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

    // The overlap-count read and the booking insert must be atomic w.r.t. any other concurrent
    // create() for the same resource, or two requests can both read "under capacity" before
    // either writes (double-booking). A MongoDB transaction, on its own, would NOT close this —
    // two concurrent inserts of distinct Booking documents don't conflict with each other at the
    // document level, so both would still commit. assertSlotAvailable's resource-lock increment
    // (see bookingLockVersion on the Resource schema) forces a real WriteConflict between the
    // two attempts on that shared document, so MongoDB serializes them: the loser is
    // automatically retried by withTransaction against a fresh snapshot that already includes
    // the winner's committed booking.
    const session = await this.connection.startSession();
    let booking: BookingDocument;
    try {
      booking = await session.withTransaction(async () => {
        const resource = await this.availabilityService.assertSlotAvailable(
          organizationId,
          input.resourceId,
          startAt,
          endAt,
          undefined,
          session,
        );

        return this.bookingsRepository.create(
          {
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
            // Snapshot, not a live join — see Booking.staffMembershipId's own doc comment.
            staffMembershipId: resource.membershipId,
          },
          session,
        );
      });
    } finally {
      await session.endSession();
    }

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

  /**
   * System-driven, not user-driven (no auditService.record, no NotFoundException) — called by
   * OrdersService.syncBookingPaymentStatusFromInvoice in reaction to `payment.completed`, not by
   * any controller. A booking that's since been deleted/cancelled is simply a no-op here: there's
   * no user-facing request to 404 against, and silently dropping a stale sync is correct.
   */
  async syncPaymentStatus(
    organizationId: string,
    bookingId: string,
    paymentStatus: BookingPaymentStatus,
  ): Promise<void> {
    await this.bookingsRepository.update(organizationId, bookingId, {
      paymentStatus,
    });
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
    // A reminder already sent for the old time no longer applies to the new one.
    const cleared = await this.bookingsRepository.clearReminderFlag(
      organizationId,
      id,
    );

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'booking',
      entityId: id,
      metadata: { rescheduled: true },
    });

    return cleared ?? updated;
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

  async complete(
    organizationId: string,
    userId: string,
    id: string,
    input: CompleteBookingInput,
  ): Promise<BookingDocument> {
    const booking = await this.getById(organizationId, id);
    if (booking.status === 'cancelled' || booking.status === 'completed') {
      throw new BadRequestException({
        code: 'BOOKING_NOT_COMPLETABLE',
        message: `Cannot complete a booking with status "${booking.status}"`,
      });
    }

    const updated = await this.bookingsRepository.update(organizationId, id, {
      status: 'completed',
      attended: input.attended,
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
      metadata: { status: 'completed', attended: input.attended },
    });

    await this.eventBus.publish(organizationId, 'booking.completed', {
      bookingId: id,
      contactId: updated.contactId.toString(),
      attended: input.attended,
    });

    if (input.attended) {
      // Best-effort — a failed confirmation send must never fail the completion that already
      // succeeded. Awaited (not fire-and-forget) so callers observe a consistent end state.
      await this.sendCompletionMessage(organizationId, updated).catch((error) =>
        this.logger.error(
          `Booking completion: failed to send confirmation for booking ${id}`,
          error,
        ),
      );
    }

    return updated;
  }

  private async sendCompletionMessage(
    organizationId: string,
    booking: BookingDocument,
  ): Promise<void> {
    const [offer, contact] = await Promise.all([
      this.offersService.getById(organizationId, booking.offerId.toString()),
      this.contactsService.getById(
        organizationId,
        booking.contactId.toString(),
      ),
    ]);
    const body = interpolate(COMPLETION_MESSAGE, {
      contact: { firstName: contact.firstName ?? '' },
      offer: { name: offer.name },
    });
    await sendWithChannelFallback(
      this.conversationsService,
      this.logger,
      organizationId,
      booking.contactId.toString(),
      body,
      'Booking completion',
    );
  }
}
