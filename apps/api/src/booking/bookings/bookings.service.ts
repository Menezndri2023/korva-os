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
import { CreditBalancesService } from '../credit-balances/credit-balances.service';
import { ReviewRequestsService } from '../../reviews/review-requests.service';

/** Training centres complete a course; every other business a visit, a stay, an appointment.
 *  The second wording used to go to everyone, so a hair salon's client was congratulated on
 *  "finishing the training". */
const TRAINING_COMPLETION_MESSAGE =
  'Bonjour {{contact.firstName}}, félicitations pour avoir terminé la formation « {{offer.name}} » ! Merci pour votre participation.';
const COMPLETION_MESSAGE =
  'Bonjour {{contact.firstName}}, merci d’avoir choisi {{organization.name}} pour « {{offer.name}} » ! À très bientôt.';
const REVIEW_INVITATION = ' Votre avis compte, il ne prend que 30 secondes : ';

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
    private readonly creditBalancesService: CreditBalancesService,
    private readonly reviewRequestsService: ReviewRequestsService,
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
    const stay = await this.resolveStay(organizationId, offer, startAt, endAt);
    // A stay already ends at check-out time; a buffer only applies to slots.
    const buffer = stay ? 0 : (offer.bufferMinutes ?? 0);

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
          { stay: stay !== null, bufferMinutes: buffer },
        );

        return this.bookingsRepository.create(
          {
            organizationId: new Types.ObjectId(organizationId),
            resourceId: new Types.ObjectId(input.resourceId),
            offerId: new Types.ObjectId(input.offerId),
            contactId: new Types.ObjectId(input.contactId),
            startAt,
            endAt,
            // A stay is priced per night; a slot at the offer's price.
            pricing: {
              amount: stay
                ? offer.pricing.amount * stay.nights
                : offer.pricing.amount,
              currency: offer.pricing.currency,
            },
            nights: stay?.nights,
            partySize: input.partySize,
            blockedUntil: buffer
              ? new Date(endAt.getTime() + buffer * 60_000)
              : undefined,
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

  /**
   * For a per-night offer (bookingUnit "night"), the stay's nights on the organization's calendar
   * — at least one, and at least the offer's minimum. Null for a slot offer.
   */
  private async resolveStay(
    organizationId: string,
    offer: { bookingUnit?: string | null; minNights?: number | null },
    startAt: Date,
    endAt: Date,
    force = false,
  ): Promise<{ nights: number } | null> {
    if (!force && offer.bookingUnit !== 'night') return null;
    const nights = await this.availabilityService.countNights(
      organizationId,
      startAt,
      endAt,
    );
    if (nights < 1) {
      throw new BadRequestException({
        code: 'STAY_TOO_SHORT',
        message: 'A stay must include at least one night',
      });
    }
    if (offer.minNights && nights < offer.minNights) {
      throw new BadRequestException({
        code: 'STAY_BELOW_MINIMUM',
        message: `This stay requires at least ${offer.minNights} nights`,
        minNights: offer.minNights,
        nights,
      });
    }
    return { nights };
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
    // A stay keeps being a stay: re-counted, re-checked for its minimum, and re-priced at the
    // same nightly rate it was booked at.
    // The buffer it was booked with moves with it.
    const buffer = booking.blockedUntil
      ? Math.round(
          (booking.blockedUntil.getTime() - booking.endAt.getTime()) / 60_000,
        )
      : 0;
    let stayUpdate:
      | { nights: number; pricing: { amount: number; currency: string } }
      | undefined;
    if (booking.nights) {
      const offer = await this.offersService.getById(
        organizationId,
        booking.offerId.toString(),
      );
      const stay = await this.resolveStay(
        organizationId,
        offer,
        startAt,
        endAt,
        true,
      );
      if (stay) {
        stayUpdate = {
          nights: stay.nights,
          pricing: {
            amount: (booking.pricing.amount / booking.nights) * stay.nights,
            currency: booking.pricing.currency,
          },
        };
      }
    }
    await this.availabilityService.assertSlotAvailable(
      organizationId,
      booking.resourceId.toString(),
      startAt,
      endAt,
      id,
      undefined,
      { stay: Boolean(booking.nights), bufferMinutes: buffer },
    );

    const updated = await this.bookingsRepository.update(organizationId, id, {
      startAt,
      endAt,
      ...stayUpdate,
      ...(buffer
        ? { blockedUntil: new Date(endAt.getTime() + buffer * 60_000) }
        : {}),
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

      // Best-effort, and only on an actual attendance — a no-show shouldn't consume a prepaid
      // session credit. No-op when the offer isn't a 'package' (checked inside the service
      // itself, so every other vertical's completion flow pays no cost for this).
      await this.creditBalancesService.decrementForBookingCompletion(
        organizationId,
        updated.contactId.toString(),
        updated.offerId.toString(),
      );
    }

    return updated;
  }

  private async sendCompletionMessage(
    organizationId: string,
    booking: BookingDocument,
  ): Promise<void> {
    const [offer, contact, invitation] = await Promise.all([
      this.offersService.getById(organizationId, booking.offerId.toString()),
      this.contactsService.getById(
        organizationId,
        booking.contactId.toString(),
      ),
      this.reviewRequestsService.invitation(
        organizationId,
        'booking',
        booking.id as string,
        booking.contactId.toString(),
      ),
    ]);
    // Suspended or deleted business: nothing goes out in its name.
    if (!invitation) return;
    const template =
      invitation.businessModel === 'training'
        ? TRAINING_COMPLETION_MESSAGE
        : COMPLETION_MESSAGE;
    const body =
      interpolate(template, {
        contact: { firstName: contact.firstName ?? '' },
        offer: { name: offer.name },
        organization: { name: invitation.organizationName },
      }) + (invitation.link ? `${REVIEW_INVITATION}${invitation.link}` : '');
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
