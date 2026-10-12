import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { ContactsRepository } from './contacts.repository';
import { ContactDocument } from './schemas/contact.schema';
import {
  Quote,
  QuoteDocument,
} from '../../finance/quotes/schemas/quote.schema';
import {
  Invoice,
  InvoiceDocument,
} from '../../finance/invoices/schemas/invoice.schema';
import {
  Booking,
  BookingDocument,
} from '../../booking/bookings/schemas/booking.schema';
import {
  Order,
  OrderDocument,
} from '../../commerce/orders/schemas/order.schema';
import {
  Conversation,
  ConversationDocument,
} from '../../communication/conversations/schemas/conversation.schema';
import { AuditService } from '../../audit/audit.service';
import { EventBusService } from '../../core/events/event-bus.service';
import { backgroundWorkersDisabled } from '../../core/background/background-workers';

export const CUSTOMER_INACTIVITY_QUEUE_NAME = 'customer-inactivity';
export const CUSTOMER_INACTIVITY_JOB_NAME = 'sweep';
export const CUSTOMER_INACTIVITY_SCHEDULER_ID = 'customer-inactivity-sweep';

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h — a lifecycle signal, not a time-critical one
const DEFAULT_THRESHOLD_DAYS = 60; // matches the brief's own canonical "60 jours" example

const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: false,
} as const;

/**
 * Periodically finds contacts with no recent activity across CRM/Finance/Booking/Commerce/
 * Communication (the same cross-module relationships the Business Graph read layer projects —
 * see business-graph.service.ts) and publishes `customer.inactive`, the flagship "fidélisation"
 * signal named throughout the Business OS brief (docs/BUSINESS_OS_AUDIT.md §3) — until this
 * scheduler, nothing in the system could ever detect that a customer had gone quiet.
 *
 * Architecture deliberately copies QuoteExpirySchedulerService (same BullMQ repeatable-job
 * pattern, same NODE_ENV=test default-disable, same multi-instance-safe upsertJobScheduler) —
 * see that file for the full reasoning on the parts that are identical. The two differences:
 * there is no single collection to scan (activity is derived by taking the most recent of this
 * contact's own `createdAt` and its newest Quote/Invoice/Booking/Order/Conversation), and
 * "eligible" isn't a status transition but a dedup marker (`Contact.inactiveNotifiedAt`) claimed
 * atomically via ContactsRepository.claimInactivity — see that method's own comment.
 */
@Injectable()
export class CustomerInactivitySchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(CustomerInactivitySchedulerService.name);
  private connection?: IORedis;
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly configService: ConfigService,
    private readonly contactsRepository: ContactsRepository,
    @InjectModel(Quote.name) private readonly quoteModel: Model<QuoteDocument>,
    @InjectModel(Invoice.name)
    private readonly invoiceModel: Model<InvoiceDocument>,
    @InjectModel(Booking.name)
    private readonly bookingModel: Model<BookingDocument>,
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBusService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.isEnabled()) {
      this.logger.log(
        'Customer inactivity scheduler disabled (test environment)',
      );
      return;
    }

    const intervalMs = this.getIntervalMs();
    this.connection = new IORedis(
      this.configService.getOrThrow<string>('REDIS_URL'),
      { maxRetriesPerRequest: null },
    );
    this.queue = new Queue(CUSTOMER_INACTIVITY_QUEUE_NAME, {
      connection: this.connection,
    });
    this.worker = new Worker(
      CUSTOMER_INACTIVITY_QUEUE_NAME,
      async () => this.runSweep(),
      { connection: this.connection },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(
        `Customer inactivity sweep job ${job?.id} failed`,
        error,
      );
    });
    this.worker.on('error', (err) => {
      this.logger.error(
        'Customer inactivity queue worker connection error',
        err,
      );
    });
    this.queue.on('error', (err) => {
      this.logger.error('Customer inactivity queue connection error', err);
    });
    await Promise.all([
      this.worker.waitUntilReady(),
      this.queue.waitUntilReady(),
    ]);

    await this.queue.upsertJobScheduler(
      CUSTOMER_INACTIVITY_SCHEDULER_ID,
      { every: intervalMs },
      { name: CUSTOMER_INACTIVITY_JOB_NAME, opts: JOB_OPTIONS },
    );
    this.logger.log(
      `Customer inactivity scheduler started (every ${intervalMs}ms, threshold ${this.getThresholdDays()}d)`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
  }

  /**
   * Each candidate's activity lookup and claim is independent — one failing must never abort
   * the rest of the sweep (same rationale as QuoteExpirySchedulerService.runSweep).
   */
  private async runSweep(): Promise<void> {
    const thresholdMs = this.getThresholdDays() * 24 * 60 * 60 * 1000;
    const thresholdDate = new Date(Date.now() - thresholdMs);
    this.logger.log('Customer inactivity sweep starting');

    const candidates =
      await this.contactsRepository.findPotentiallyInactive(thresholdDate);
    if (candidates.length === 0) {
      this.logger.log('Customer inactivity sweep finished: candidates=0');
      return;
    }

    const lastActivityByContact = await this.computeLastActivity(candidates);
    let notified = 0;

    for (const contact of candidates) {
      const contactId = contact.id as string;
      try {
        const contactCreatedAt = (contact as unknown as { createdAt: Date })
          .createdAt;
        const lastActivityAt =
          lastActivityByContact.get(contactId) ?? contactCreatedAt;
        if (lastActivityAt >= thresholdDate) continue; // activity moved it out of the window

        const claimed = await this.contactsRepository.claimInactivity(
          contact.organizationId.toString(),
          contactId,
          lastActivityAt,
          new Date(),
        );
        if (!claimed) continue; // already claimed this episode (by this tick or a concurrent one)

        notified += 1;
        await this.auditService.record({
          organizationId: contact.organizationId.toString(),
          action: 'UPDATE',
          entity: 'contact',
          entityId: contactId,
          metadata: { event: 'customer.inactive', automated: true },
        });
        await this.eventBus.publish(
          contact.organizationId.toString(),
          'customer.inactive',
          {
            contactId,
            lastActivityAt: lastActivityAt.toISOString(),
            inactiveDays: Math.floor(
              (Date.now() - lastActivityAt.getTime()) / (24 * 60 * 60 * 1000),
            ),
          },
        );
      } catch (error) {
        this.logger.error(
          `Customer inactivity sweep: failed on Contact ${contactId}`,
          error,
        );
      }
    }

    this.logger.log(
      `Customer inactivity sweep finished: candidates=${candidates.length} notified=${notified}`,
    );
  }

  /**
   * One `$group`-by-contactId aggregation per activity collection, scoped to just this batch's
   * candidate ids (bounded, not a full-collection scan) — merged into a single
   * contactId -> most-recent-activity map. Payments/Tasks are intentionally not queried here:
   * a Payment always implies its Invoice was already active, and a Task's own `dueAt`/creation
   * doesn't represent the *customer* doing anything (it's staff-initiated) — both would only
   * ever move a contact's last-activity earlier than an already-counted signal, never later.
   */
  private async computeLastActivity(
    candidates: ContactDocument[],
  ): Promise<Map<string, Date>> {
    const contactIds = candidates.map((c) => c._id);
    const models: Model<{ contactId: Types.ObjectId }>[] = [
      this.quoteModel as never,
      this.invoiceModel as never,
      this.bookingModel as never,
      this.orderModel as never,
      this.conversationModel as never,
    ];

    const results = await Promise.all(
      models.map((model) =>
        model.aggregate<{ _id: Types.ObjectId; last: Date }>([
          { $match: { contactId: { $in: contactIds } } },
          { $group: { _id: '$contactId', last: { $max: '$createdAt' } } },
        ]),
      ),
    );

    const lastActivity = new Map<string, Date>();
    for (const rows of results) {
      for (const row of rows) {
        const id = row._id.toString();
        const existing = lastActivity.get(id);
        if (!existing || row.last > existing) {
          lastActivity.set(id, row.last);
        }
      }
    }
    return lastActivity;
  }

  private isEnabled(): boolean {
    // A CLI script building an application context must not start background work —
    // see core/background/background-workers.ts.
    if (backgroundWorkersDisabled(this.configService)) return false;
    const override = this.configService.get<string>(
      'CUSTOMER_INACTIVITY_ENABLED',
    );
    if (override !== undefined) return override === 'true';
    return this.configService.get<string>('NODE_ENV') !== 'test';
  }

  private getIntervalMs(): number {
    const raw = this.configService.get<string>(
      'CUSTOMER_INACTIVITY_INTERVAL_MS',
    );
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INTERVAL_MS;
  }

  private getThresholdDays(): number {
    const raw = this.configService.get<string>(
      'CUSTOMER_INACTIVITY_THRESHOLD_DAYS',
    );
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULT_THRESHOLD_DAYS;
  }
}
