import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { CartsRepository } from './carts.repository';
import { OffersService } from '../../catalog/offers/offers.service';
import { ContactsService } from '../../crm/contacts/contacts.service';
import { OrganizationsService } from '../../organizations/organizations.service';
import { ConversationsService } from '../../communication/conversations/conversations.service';
import { AuditService } from '../../audit/audit.service';
import { interpolate } from '../../shared/template';
import { sendWithChannelFallback } from '../../communication/notify-contact-with-fallback';

export const ABANDONED_CART_QUEUE_NAME = 'abandoned-cart-reminder';
export const ABANDONED_CART_JOB_NAME = 'sweep';
export const ABANDONED_CART_SCHEDULER_ID = 'abandoned-cart-reminder-sweep';

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;
const DEFAULT_THRESHOLD_HOURS = 3;

/** See QuoteExpirySchedulerService's JOB_OPTIONS — identical reasoning. */
const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: false,
} as const;

const DEFAULT_MESSAGE =
  "Bonjour {{contact.firstName}}, vous avez laissé {{items}} dans votre panier chez {{organization.name}}. Revenez les récupérer avant qu'ils ne soient plus disponibles !";

/**
 * Periodically finds Carts left untouched (no item added/changed) for more than
 * ABANDONED_CART_THRESHOLD_HOURS and sends a WhatsApp-first, email-fallback recovery message —
 * same BullMQ repeatable-job architecture as BookingReminderSchedulerService, only reproduced
 * here where it diverges. The one real precondition this feature depends on: a Cart only exists
 * for a contact once PublicService#trackCheckoutStarted has run (fired from the storefront's
 * CheckoutPanel once an email is known) — the storefront's own cart is otherwise a
 * localStorage-only, backend-invisible concept (see apps/storefront/src/lib/use-cart.ts), so an
 * anonymous visitor who never reaches the email field of checkout can never be recovered; that's
 * an inherent, accepted limitation of the channel, not a bug in this scheduler.
 */
@Injectable()
export class AbandonedCartReminderSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    AbandonedCartReminderSchedulerService.name,
  );
  private connection?: IORedis;
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly configService: ConfigService,
    private readonly cartsRepository: CartsRepository,
    private readonly offersService: OffersService,
    private readonly contactsService: ContactsService,
    private readonly organizationsService: OrganizationsService,
    private readonly conversationsService: ConversationsService,
    private readonly auditService: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.isEnabled()) {
      this.logger.log(
        'Abandoned-cart reminder scheduler disabled (test environment)',
      );
      return;
    }

    const intervalMs = this.getIntervalMs();
    this.connection = new IORedis(
      this.configService.getOrThrow<string>('REDIS_URL'),
      { maxRetriesPerRequest: null },
    );
    this.queue = new Queue(ABANDONED_CART_QUEUE_NAME, {
      connection: this.connection,
    });
    this.worker = new Worker(
      ABANDONED_CART_QUEUE_NAME,
      async () => this.runSweep(),
      { connection: this.connection },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(
        `Abandoned-cart reminder sweep job ${job?.id} failed`,
        error,
      );
    });
    this.worker.on('error', (err) => {
      this.logger.error(
        'Abandoned-cart reminder queue worker connection error',
        err,
      );
    });
    this.queue.on('error', (err) => {
      this.logger.error('Abandoned-cart reminder queue connection error', err);
    });
    await Promise.all([
      this.worker.waitUntilReady(),
      this.queue.waitUntilReady(),
    ]);

    await this.queue.upsertJobScheduler(
      ABANDONED_CART_SCHEDULER_ID,
      { every: intervalMs },
      { name: ABANDONED_CART_JOB_NAME, opts: JOB_OPTIONS },
    );
    this.logger.log(
      `Abandoned-cart reminder scheduler started (every ${intervalMs}ms)`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
  }

  /** Public (not private) so e2e tests can trigger a sweep deterministically — same reasoning as
   *  BookingReminderSchedulerService.runSweep. */
  async runSweep(): Promise<void> {
    this.logger.log('Abandoned-cart reminder sweep starting');
    const thresholdMs = this.getThresholdHours() * 60 * 60 * 1000;
    const olderThan = new Date(Date.now() - thresholdMs);
    const candidates =
      await this.cartsRepository.findAbandonedCandidates(olderThan);
    let sent = 0;
    let skipped = 0;

    for (const candidate of candidates) {
      const organizationId = candidate.organizationId.toString();
      const cartId = candidate.id as string;
      try {
        const [organization, contact, offers] = await Promise.all([
          this.organizationsService.getById(organizationId),
          this.contactsService.getById(
            organizationId,
            candidate.contactId.toString(),
          ),
          Promise.all(
            candidate.items.map((item) =>
              this.offersService
                .getById(organizationId, item.offerId.toString())
                .catch(() => null),
            ),
          ),
        ]);

        const itemNames = offers
          .filter((offer): offer is NonNullable<typeof offer> => offer != null)
          .map((offer) => offer.name);
        if (itemNames.length === 0) {
          // Every offer in this cart was deleted since — nothing meaningful to remind about.
          skipped += 1;
          continue;
        }

        const body = interpolate(DEFAULT_MESSAGE, {
          contact: { firstName: contact.firstName ?? '' },
          organization: { name: organization.name },
          items: itemNames.join(', '),
        });

        const channel = await sendWithChannelFallback(
          this.conversationsService,
          this.logger,
          organizationId,
          candidate.contactId.toString(),
          body,
          'Abandoned-cart reminder',
        );
        if (!channel) {
          skipped += 1;
          continue;
        }

        const updated = await this.cartsRepository.markAbandonedIfEligible(
          organizationId,
          cartId,
        );
        if (!updated) continue; // no longer eligible — converted concurrently mid-sweep

        sent += 1;
        await this.auditService.record({
          organizationId,
          action: 'UPDATE',
          entity: 'cart',
          entityId: cartId,
          metadata: { abandonedReminderSent: true, channel },
        });
      } catch (error) {
        this.logger.error(
          `Abandoned-cart reminder sweep: failed on Cart ${cartId}`,
          error,
        );
      }
    }

    this.logger.log(
      `Abandoned-cart reminder sweep finished: candidates=${candidates.length} sent=${sent} skipped=${skipped}`,
    );
  }

  private isEnabled(): boolean {
    const override = this.configService.get<string>(
      'ABANDONED_CART_REMINDER_ENABLED',
    );
    if (override !== undefined) return override === 'true';
    return this.configService.get<string>('NODE_ENV') !== 'test';
  }

  private getIntervalMs(): number {
    const raw = this.configService.get<string>(
      'ABANDONED_CART_REMINDER_INTERVAL_MS',
    );
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INTERVAL_MS;
  }

  private getThresholdHours(): number {
    const raw = this.configService.get<string>(
      'ABANDONED_CART_THRESHOLD_HOURS',
    );
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULT_THRESHOLD_HOURS;
  }
}
