import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { BookingsRepository } from './bookings.repository';
import { OffersService } from '../../catalog/offers/offers.service';
import { ContactsService } from '../../crm/contacts/contacts.service';
import { ConversationsService } from '../../communication/conversations/conversations.service';
import { AuditService } from '../../audit/audit.service';
import { EventBusService } from '../../core/events/event-bus.service';
import { interpolate } from '../../shared/template';
import { sendWithChannelFallback } from '../../communication/notify-contact-with-fallback';

export const BOOKING_REMINDER_QUEUE_NAME = 'booking-reminder';
export const BOOKING_REMINDER_JOB_NAME = 'sweep';
export const BOOKING_REMINDER_SCHEDULER_ID = 'booking-reminder-sweep';

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_WINDOW_HOURS = 24;

/** See QuoteExpirySchedulerService's JOB_OPTIONS — identical reasoning, applied to reminders. */
const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: false,
} as const;

const DEFAULT_MESSAGE =
  'Bonjour {{contact.firstName}}, un rappel pour votre rendez-vous « {{offer.name}} » le {{booking.date}} à {{booking.heure}}. À bientôt !';

/**
 * Periodically finds active (pending/confirmed) Bookings starting within the next
 * BOOKING_REMINDER_WINDOW_HOURS that haven't been reminded yet, and sends a WhatsApp (falling
 * back to email) message to the contact. Same BullMQ repeatable-job architecture as
 * InvoiceOverdueSchedulerService — see that file for the full reasoning; only reproduced here
 * where it diverges. The one structural difference: this sweep looks FORWARD (an appointment
 * that hasn't happened yet) instead of backward past a threshold, so there's no natural status
 * transition to guard re-processing — Booking.reminderSentAt is a dedicated dedup marker instead
 * (see BookingsRepository.findUpcomingUnreminded/markReminderSentIfEligible).
 *
 * Channel choice: WhatsApp first (best fit for a same-day appointment reminder), falling back to
 * email when the contact has no active WhatsApp consent on file — never SMS in v1 (see the plan
 * this shipped from for why). A contact with neither available is skipped, logged, and counted,
 * never treated as a sweep failure.
 */
@Injectable()
export class BookingReminderSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(BookingReminderSchedulerService.name);
  private connection?: IORedis;
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly configService: ConfigService,
    private readonly bookingsRepository: BookingsRepository,
    private readonly offersService: OffersService,
    private readonly contactsService: ContactsService,
    private readonly conversationsService: ConversationsService,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBusService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.isEnabled()) {
      this.logger.log('Booking reminder scheduler disabled (test environment)');
      return;
    }

    const intervalMs = this.getIntervalMs();
    this.connection = new IORedis(
      this.configService.getOrThrow<string>('REDIS_URL'),
      { maxRetriesPerRequest: null },
    );
    this.queue = new Queue(BOOKING_REMINDER_QUEUE_NAME, {
      connection: this.connection,
    });
    this.worker = new Worker(
      BOOKING_REMINDER_QUEUE_NAME,
      async () => this.runSweep(),
      { connection: this.connection },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(`Booking reminder sweep job ${job?.id} failed`, error);
    });
    this.worker.on('error', (err) => {
      this.logger.error('Booking reminder queue worker connection error', err);
    });
    this.queue.on('error', (err) => {
      this.logger.error('Booking reminder queue connection error', err);
    });
    await Promise.all([
      this.worker.waitUntilReady(),
      this.queue.waitUntilReady(),
    ]);

    await this.queue.upsertJobScheduler(
      BOOKING_REMINDER_SCHEDULER_ID,
      { every: intervalMs },
      { name: BOOKING_REMINDER_JOB_NAME, opts: JOB_OPTIONS },
    );
    this.logger.log(
      `Booking reminder scheduler started (every ${intervalMs}ms)`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
  }

  /** Public (not private) so e2e tests can trigger a sweep deterministically instead of racing
   *  upsertJobScheduler's first tick — same reasoning/pattern as CalendarSyncSchedulerService. */
  async runSweep(): Promise<void> {
    this.logger.log('Booking reminder sweep starting');
    const windowMs = this.getWindowHours() * 60 * 60 * 1000;
    const candidates =
      await this.bookingsRepository.findUpcomingUnreminded(windowMs);
    let sent = 0;
    let skipped = 0;

    for (const candidate of candidates) {
      const organizationId = candidate.organizationId.toString();
      const bookingId = candidate.id as string;
      try {
        const [offer, contact] = await Promise.all([
          this.offersService.getById(
            organizationId,
            candidate.offerId.toString(),
          ),
          this.contactsService.getById(
            organizationId,
            candidate.contactId.toString(),
          ),
        ]);

        const payload = {
          contact: { firstName: contact.firstName ?? '' },
          offer: { name: offer.name },
          booking: {
            date: candidate.startAt.toLocaleDateString('fr-FR'),
            heure: candidate.startAt.toLocaleTimeString('fr-FR', {
              hour: '2-digit',
              minute: '2-digit',
            }),
          },
        };
        const body = interpolate(DEFAULT_MESSAGE, payload);

        const channel = await sendWithChannelFallback(
          this.conversationsService,
          this.logger,
          organizationId,
          candidate.contactId.toString(),
          body,
          'Booking reminder',
        );
        if (!channel) {
          skipped += 1;
          continue;
        }

        const updated =
          await this.bookingsRepository.markReminderSentIfEligible(
            organizationId,
            bookingId,
          );
        if (!updated) continue; // no longer eligible — a concurrent change already resolved it

        sent += 1;
        await this.auditService.record({
          organizationId,
          action: 'UPDATE',
          entity: 'booking',
          entityId: bookingId,
          metadata: { reminderSent: true, channel },
        });
        await this.eventBus.publish(organizationId, 'booking.reminder_sent', {
          bookingId,
          contactId: candidate.contactId.toString(),
          channel,
        });
      } catch (error) {
        this.logger.error(
          `Booking reminder sweep: failed on Booking ${bookingId}`,
          error,
        );
      }
    }

    this.logger.log(
      `Booking reminder sweep finished: candidates=${candidates.length} sent=${sent} skipped=${skipped}`,
    );
  }

  private isEnabled(): boolean {
    const override = this.configService.get<string>('BOOKING_REMINDER_ENABLED');
    if (override !== undefined) return override === 'true';
    return this.configService.get<string>('NODE_ENV') !== 'test';
  }

  private getIntervalMs(): number {
    const raw = this.configService.get<string>('BOOKING_REMINDER_INTERVAL_MS');
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INTERVAL_MS;
  }

  private getWindowHours(): number {
    const raw = this.configService.get<string>('BOOKING_REMINDER_WINDOW_HOURS');
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULT_WINDOW_HOURS;
  }
}
