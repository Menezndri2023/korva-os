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

/**
 * Consumes the 'events' queue and hands each event to the WorkflowEngine.
 * Runs as a BullMQ Worker inside the API process — decoupled from the HTTP
 * request/response cycle (jobs are processed on Redis's own schedule, not
 * synchronously with the publishing request) but colocated with the API so
 * action handlers (e.g. create_task) can reuse existing Nest services
 * directly. See docs/architecture-decisions.md for the tradeoff.
 */
@Injectable()
export class EventsProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventsProcessor.name);
  private connection?: IORedis;
  private worker?: Worker<EventJobData>;

  constructor(
    private readonly configService: ConfigService,
    private readonly workflowEngineService: WorkflowEngineService,
  ) {}

  onModuleInit(): void {
    this.connection = new IORedis(
      this.configService.getOrThrow<string>('REDIS_URL'),
      {
        maxRetriesPerRequest: null,
      },
    );
    this.worker = new Worker<EventJobData>(
      EVENTS_QUEUE_NAME,
      async (job) => {
        await this.workflowEngineService.handleEvent(
          job.data.organizationId,
          job.data.name,
          job.data.payload,
          job.data.eventKey,
        );
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
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    this.connection?.disconnect();
  }
}
