import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type { CreateWaitlistEntryInput } from '@korva/validation';
import type { Pagination } from '@korva/types';
import {
  WaitlistRepository,
  FindWaitlistEntriesOptions,
} from './waitlist.repository';
import { WaitlistEntryDocument } from './schemas/waitlist-entry.schema';
import { AvailabilityService } from '../availability/availability.service';
import { BookingsService } from '../bookings/bookings.service';
import { ContactsService } from '../../crm/contacts/contacts.service';
import { OffersService } from '../../catalog/offers/offers.service';
import { ConversationsService } from '../../communication/conversations/conversations.service';
import { sendWithChannelFallback } from '../../communication/notify-contact-with-fallback';
import { interpolate } from '../../shared/template';
import { AuditService } from '../../audit/audit.service';
import { intlLocaleOf, orgLocale } from '../../shared/i18n';
import { OrganizationsService } from '../../organizations/organizations.service';

// In the business's language (shared/i18n.ts).
const NOTIFICATION_MESSAGE = {
  fr: "Bonjour {{contact.firstName}}, une place s'est libérée pour « {{offer.name}} » le {{booking.date}} à {{booking.heure}}. Contactez-nous vite pour la réserver !",
  en: 'Hello {{contact.firstName}}, a place has opened up for “{{offer.name}}” on {{booking.date}} at {{booking.heure}}. Contact us quickly to book it!',
};

/** Extracts a NestJS HttpException's `.response.code` — same shape/reasoning as the identical
 *  helper in notify-contact-with-fallback.ts, kept local here since this one branches control
 *  flow on a SPECIFIC code rather than just logging, a different enough use to not force a
 *  shared abstraction for two callers. */
function errorCode(error: unknown): string | undefined {
  const response = (error as { response?: unknown } | undefined)?.response;
  return response && typeof response === 'object' && 'code' in response
    ? String(response.code)
    : undefined;
}

@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);

  constructor(
    private readonly waitlistRepository: WaitlistRepository,
    private readonly availabilityService: AvailabilityService,
    private readonly bookingsService: BookingsService,
    private readonly contactsService: ContactsService,
    private readonly offersService: OffersService,
    private readonly conversationsService: ConversationsService,
    private readonly auditService: AuditService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  /**
   * Confirmed "genuinely full" via the real availability check, not assumed from the client's
   * say-so — the one acceptable rejection is SLOT_UNAVAILABLE (capacity); any other rejection
   * (outside hours, blocked, inactive resource, not found) means the slot was never bookable in
   * the first place and waitlisting it wouldn't make sense either, so those propagate as-is.
   * If the slot turns out to actually be available, this rejects with WAITLIST_SLOT_AVAILABLE —
   * the caller should just book it directly instead.
   */
  async create(
    organizationId: string,
    userId: string,
    input: CreateWaitlistEntryInput,
  ): Promise<WaitlistEntryDocument> {
    const startAt = new Date(input.startAt);
    const endAt = new Date(input.endAt);

    let slotIsFull = false;
    try {
      await this.availabilityService.assertSlotAvailable(
        organizationId,
        input.resourceId,
        startAt,
        endAt,
      );
    } catch (error) {
      if (errorCode(error) !== 'SLOT_UNAVAILABLE') throw error;
      slotIsFull = true;
    }
    if (!slotIsFull) {
      throw new BadRequestException({
        code: 'WAITLIST_SLOT_AVAILABLE',
        message:
          'This slot is currently available — book it directly instead of waitlisting',
      });
    }

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
    // Confirms the offer exists and belongs to this organization.
    await this.offersService.getById(organizationId, input.offerId);

    const entry = await this.waitlistRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      resourceId: new Types.ObjectId(input.resourceId),
      offerId: new Types.ObjectId(input.offerId),
      contactId: new Types.ObjectId(input.contactId),
      startAt,
      endAt,
      notes: input.notes,
    });

    await this.auditService.record({
      organizationId,
      userId,
      action: 'CREATE',
      entity: 'waitlist_entry',
      entityId: entry.id as string,
    });

    return entry;
  }

  async getById(
    organizationId: string,
    id: string,
  ): Promise<WaitlistEntryDocument> {
    const entry = await this.waitlistRepository.findById(organizationId, id);
    if (!entry) {
      throw new NotFoundException({
        code: 'WAITLIST_ENTRY_NOT_FOUND',
        message: 'Waitlist entry not found',
      });
    }
    return entry;
  }

  async list(
    organizationId: string,
    query: FindWaitlistEntriesOptions,
  ): Promise<{ data: WaitlistEntryDocument[]; pagination: Pagination }> {
    const { data, total } = await this.waitlistRepository.findAll(
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

  async cancel(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<WaitlistEntryDocument> {
    const updated = await this.waitlistRepository.cancel(organizationId, id);
    if (!updated) {
      throw new NotFoundException({
        code: 'WAITLIST_ENTRY_NOT_FOUND',
        message: 'Waitlist entry not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'waitlist_entry',
      entityId: id,
      metadata: { status: 'cancelled' },
    });

    return updated;
  }

  /**
   * Reacts to `booking.cancelled` — notifies the single oldest still-waiting entry for that
   * resource whose desired slot overlaps the one that just freed up (FIFO), best-effort (never
   * throws, so one contact's channel gap never breaks the event-processing fan-out it's called
   * from — see EventsProcessor). Deliberately does not auto-create a Booking for them: a human
   * still confirms and books, same as every other notification this codebase sends.
   */
  async handleBookingCancelled(
    organizationId: string,
    bookingId: string,
  ): Promise<void> {
    try {
      const booking = await this.bookingsService.getById(
        organizationId,
        bookingId,
      );
      const candidates = await this.waitlistRepository.findWaitingOverlapping(
        organizationId,
        booking.resourceId.toString(),
        booking.startAt,
        booking.endAt,
      );
      if (candidates.length === 0) return;

      const next = candidates[0]!;
      const claimed = await this.waitlistRepository.markNotifiedIfWaiting(
        organizationId,
        next.id as string,
      );
      if (!claimed) return; // lost a concurrent race — nothing to notify

      const [offer, contact, organization] = await Promise.all([
        this.offersService.getById(organizationId, claimed.offerId.toString()),
        this.contactsService.getById(
          organizationId,
          claimed.contactId.toString(),
        ),
        this.organizationsService.getById(organizationId),
      ]);
      const intl = intlLocaleOf(organization.language);
      const body = interpolate(
        NOTIFICATION_MESSAGE[orgLocale(organization.language)],
        {
          contact: { firstName: contact.firstName ?? '' },
          offer: { name: offer.name },
          booking: {
            date: claimed.startAt.toLocaleDateString(intl),
            heure: claimed.startAt.toLocaleTimeString(intl, {
              hour: '2-digit',
              minute: '2-digit',
            }),
          },
        },
      );
      await sendWithChannelFallback(
        this.conversationsService,
        this.logger,
        organizationId,
        claimed.contactId.toString(),
        body,
        'Waitlist notification',
      );
    } catch (error) {
      this.logger.error(
        `Waitlist: failed to process booking.cancelled for booking ${bookingId}`,
        error,
      );
    }
  }
}
