import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { RecurringBillingRepository } from './recurring-billing.repository';
import { addInterval } from './recurring-billing.service';
import { InvoicesService } from '../invoices/invoices.service';
// Direct model injection, not OffersService/CatalogModule — see recurring-billing.service.ts's
// matching comment for why (CatalogModule already imports FinanceModule).
import {
  Offer,
  OfferDocument,
} from '../../catalog/offers/schemas/offer.schema';
import { AuditService } from '../../audit/audit.service';
import { EventBusService } from '../../core/events/event-bus.service';

export const RECURRING_BILLING_QUEUE_NAME = 'recurring-billing';
export const RECURRING_BILLING_JOB_NAME = 'sweep';
export const RECURRING_BILLING_SCHEDULER_ID = 'recurring-billing-sweep';

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: false,
} as const;

/**
 * Periodically finds active RecurringBilling plans whose `nextBillingDate` has arrived,
 * generates one Invoice per plan (via InvoicesService.create — a genuinely standalone invoice,
 * not derived from an order/quote), advances `nextBillingDate` by the plan's interval, and
 * publishes `recurring_billing.charged`. Same BullMQ repeatable-job architecture as every other
 * scheduler in this codebase (see QuoteExpirySchedulerService's own doc comment for the full
 * reasoning — reproduced only where it diverges here).
 *
 * `runSweep()` is deliberately public (not private, unlike QuoteExpirySchedulerService) so an
 * e2e test can call it directly instead of fighting BullMQ's confirmed-empirically
 * fires-immediately-on-registration quirk via onModuleInit() — see
 * CalendarSyncSchedulerService/BookingReminderSchedulerService for the same established pattern.
 */
@Injectable()
export class RecurringBillingSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RecurringBillingSchedulerService.name);
  private connection?: IORedis;
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly configService: ConfigService,
    private readonly recurringBillingRepository: RecurringBillingRepository,
    private readonly invoicesService: InvoicesService,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBusService,
    @InjectModel(Offer.name) private readonly offerModel: Model<OfferDocument>,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.isEnabled()) {
      this.logger.log(
        'Recurring billing scheduler disabled (test environment)',
      );
      return;
    }

    const intervalMs = this.getIntervalMs();
    this.connection = new IORedis(
      this.configService.getOrThrow<string>('REDIS_URL'),
      { maxRetriesPerRequest: null },
    );
    this.queue = new Queue(RECURRING_BILLING_QUEUE_NAME, {
      connection: this.connection,
    });
    this.worker = new Worker(
      RECURRING_BILLING_QUEUE_NAME,
      async () => this.runSweep(),
      { connection: this.connection },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(`Recurring billing sweep job ${job?.id} failed`, error);
    });
    this.worker.on('error', (err) => {
      this.logger.error('Recurring billing queue worker connection error', err);
    });
    this.queue.on('error', (err) => {
      this.logger.error('Recurring billing queue connection error', err);
    });
    await Promise.all([
      this.worker.waitUntilReady(),
      this.queue.waitUntilReady(),
    ]);

    await this.queue.upsertJobScheduler(
      RECURRING_BILLING_SCHEDULER_ID,
      { every: intervalMs },
      { name: RECURRING_BILLING_JOB_NAME, opts: JOB_OPTIONS },
    );
    this.logger.log(
      `Recurring billing scheduler started (every ${intervalMs}ms)`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
  }

  /** Each plan is charged independently — one failing (a deleted offer, a transient Mongo
   *  error, ...) must never abort the rest of the sweep. */
  async runSweep(): Promise<void> {
    this.logger.log('Recurring billing sweep starting');
    const due = await this.recurringBillingRepository.findDue(new Date());
    let charged = 0;

    for (const plan of due) {
      try {
        const organizationId = plan.organizationId.toString();
        const offer = await this.offerModel
          .findOne({ _id: plan.offerId, organizationId: plan.organizationId })
          .exec();
        if (!offer) {
          this.logger.warn(
            `Recurring billing sweep: offer ${plan.offerId.toString()} for plan ${plan.id as string} no longer exists — skipping this tick`,
          );
          continue;
        }

        const invoice = await this.invoicesService.create(
          organizationId,
          undefined,
          {
            contactId: plan.contactId.toString(),
            items: [
              {
                offerId: plan.offerId.toString(),
                description: offer.name,
                quantity: 1,
                unitPrice: plan.amount,
              },
            ],
            currency: plan.currency,
          },
        );

        const nextBillingDate = addInterval(
          plan.nextBillingDate,
          plan.interval,
        );
        const updated = await this.recurringBillingRepository.recordCharge(
          plan.id as string,
          nextBillingDate,
          invoice.id as string,
        );
        if (!updated) continue; // cancelled by the owner between findDue() and this write

        charged += 1;
        await this.auditService.record({
          organizationId,
          action: 'CREATE',
          entity: 'invoice',
          entityId: invoice.id as string,
          metadata: { automated: true, recurringBillingId: plan.id as string },
        });
        await this.eventBus.publish(
          organizationId,
          'recurring_billing.charged',
          {
            recurringBillingId: plan.id as string,
            contactId: plan.contactId.toString(),
            invoiceId: invoice.id as string,
            amount: plan.amount,
          },
        );
      } catch (error) {
        this.logger.error(
          `Recurring billing sweep: failed on plan ${plan.id as string}`,
          error,
        );
      }
    }

    this.logger.log(
      `Recurring billing sweep finished: due=${due.length} charged=${charged}`,
    );
  }

  private isEnabled(): boolean {
    const override = this.configService.get<string>(
      'RECURRING_BILLING_ENABLED',
    );
    if (override !== undefined) return override === 'true';
    return this.configService.get<string>('NODE_ENV') !== 'test';
  }

  private getIntervalMs(): number {
    const raw = this.configService.get<string>('RECURRING_BILLING_INTERVAL_MS');
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INTERVAL_MS;
  }
}
