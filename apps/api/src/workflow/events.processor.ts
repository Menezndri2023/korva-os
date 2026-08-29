import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { EVENTS_QUEUE_NAME, EventJobData } from '../core/events/event-names';
import { WorkflowEngineService } from './workflow-engine.service';
import { DecisionEngineService } from '../decision-engine/decision-engine.service';
import { OrdersService } from '../commerce/orders/orders.service';
import { WebhookDispatchService } from '../webhook-subscriptions/webhook-dispatch.service';

/**
 * Consumes the 'events' queue and hands each event to both the WorkflowEngine (user-configured
 * automation) and the Decision Engine (system-authored business-health rules — see
 * decision-engine.service.ts). Runs as a BullMQ Worker inside the API process — decoupled from
 * the HTTP request/response cycle (jobs are processed on Redis's own schedule, not
 * synchronously with the publishing request) but colocated with the API so
 * action handlers (e.g. create_task) can reuse existing Nest services
 * directly. See docs/architecture-decisions.md for the tradeoff.
 *
 * Also reacts to `payment.completed` specifically to sync `Booking.paymentStatus` — see
 * OrdersService.syncBookingPaymentStatusFromInvoice's own doc for why this lives there rather
 * than as a fourth standalone engine — and dispatches EVERY event to this organization's
 * external webhook subscriptions (see WebhookDispatchService's own doc).
 */
@Injectable()
export class EventsProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventsProcessor.name);
  private connection?: IORedis;
  private worker?: Worker<EventJobData>;

  constructor(
    private readonly configService: ConfigService,
    private readonly workflowEngineService: WorkflowEngineService,
    private readonly decisionEngineService: DecisionEngineService,
    private readonly ordersService: OrdersService,
    private readonly webhookDispatchService: WebhookDispatchService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.connection = new IORedis(
      this.configService.getOrThrow<string>('REDIS_URL'),
      {
        maxRetriesPerRequest: null,
      },
    );
    this.worker = new Worker<EventJobData>(
      EVENTS_QUEUE_NAME,
      async (job) => {
        // DecisionEngineService, syncBookingPaymentStatusFromInvoice, and dispatchEvent never
        // throw (see their own handleEvent/doc) — all are included in Promise.all purely so they
        // can run concurrently with the Workflow Engine, not because their failure needs
        // isolating from WorkflowEngineService's own retryable-error contract (unchanged from
        // before any of them existed).
        const tasks: Promise<void>[] = [
          this.workflowEngineService.handleEvent(
            job.data.organizationId,
            job.data.name,
            job.data.payload,
            job.data.eventKey,
          ),
          this.decisionEngineService.handleEvent(
            job.data.organizationId,
            job.data.name,
            job.data.payload,
          ),
          this.webhookDispatchService.dispatchEvent(
            job.data.organizationId,
            job.data.name,
            job.data.payload,
          ),
        ];
        if (job.data.name === 'payment.completed') {
          const invoiceId = job.data.payload.invoiceId;
          if (typeof invoiceId === 'string') {
            tasks.push(
              this.ordersService.syncBookingPaymentStatusFromInvoice(
                job.data.organizationId,
                invoiceId,
              ),
            );
          }
        }
        await Promise.all(tasks);
      },
      { connection: this.connection },
    );
    this.worker.on('failed', (job, error) => {
      const attemptsMade = job?.attemptsMade ?? 0;
      const attempts = job?.opts.attempts ?? 1;
      const exhausted = attemptsMade >= attempts;
      this.logger.error(
        `Event job ${job?.id} ("${job?.data.name}") failed on attempt ${attemptsMade}/${attempts}` +
          (exhausted
            ? ' — attempts exhausted, job left in the failed set'
            : ' — will retry'),
        error,
      );
    });
    // BullMQ's Worker re-emits any connection-level failure as its own 'error' event (e.g. from
    // the async cleanup steps inside close()); an EventEmitter's 'error' event with no listener
    // is a Node-level fatal — this must always have a handler, the same way queue-alerting.service.ts
    // already does for its QueueEvents connections.
    this.worker.on('error', (err) => {
      this.logger.error('Events queue worker connection error', err);
    });
    // Ensures the connection has fully reached 'ready' before this method (and therefore
    // onModuleInit) resolves. Without this, onModuleDestroy's worker.close() can run while the
    // connection is still mid-handshake ('initializing'); BullMQ's close() then takes a
    // hard-disconnect path on that connection and separately suppresses only one of the two
    // internal listeners on its still-rejecting init promise — the other one re-emits 'error' on
    // a connection wrapper this class never gets a handle on, with no listener attached anywhere,
    // producing an unhandled "Connection is closed" error at the process level. Waiting for
    // 'ready' here means close() always sees a fully-initialized connection and takes its normal
    // graceful-quit path instead.
    await this.worker.waitUntilReady();
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    this.connection?.disconnect();
  }
}
