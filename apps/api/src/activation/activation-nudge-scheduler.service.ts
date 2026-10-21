import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { backgroundWorkersDisabled } from '../core/background/background-workers';
import { ActivationNudgeService } from './activation-nudge.service';

export const ACTIVATION_NUDGE_QUEUE_NAME = 'activation-nudge';
export const ACTIVATION_NUDGE_JOB_NAME = 'sweep';
export const ACTIVATION_NUDGE_SCHEDULER_ID = 'activation-nudge-sweep';

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: false,
} as const;

/**
 * Runs ActivationNudgeService hourly. Same BullMQ repeatable-job pattern as
 * QuoteExpirySchedulerService (multi-instance safe through upsertJobScheduler), disabled under
 * NODE_ENV=test unless ACTIVATION_NUDGE_ENABLED overrides it. One Worker and no QueueEvents
 * listener: one blocking Redis loop, not two (see the BullMQ cost note in the infra docs).
 */
@Injectable()
export class ActivationNudgeSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ActivationNudgeSchedulerService.name);
  private connection?: IORedis;
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly configService: ConfigService,
    private readonly nudgeService: ActivationNudgeService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.isEnabled()) {
      this.logger.log('Activation nudge scheduler disabled');
      return;
    }
    const intervalMs = this.getIntervalMs();
    this.connection = new IORedis(
      this.configService.getOrThrow<string>('REDIS_URL'),
      { maxRetriesPerRequest: null },
    );
    this.queue = new Queue(ACTIVATION_NUDGE_QUEUE_NAME, {
      connection: this.connection,
    });
    this.worker = new Worker(
      ACTIVATION_NUDGE_QUEUE_NAME,
      async () => {
        const { candidates, sent } = await this.nudgeService.sendDueNudges();
        this.logger.log(
          `Activation nudge sweep finished: candidates=${candidates} sent=${sent}`,
        );
      },
      { connection: this.connection },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(`Activation nudge job ${job?.id} failed`, error);
    });
    this.worker.on('error', (err) => {
      this.logger.error('Activation nudge worker connection error', err);
    });
    this.queue.on('error', (err) => {
      this.logger.error('Activation nudge queue connection error', err);
    });
    await Promise.all([
      this.worker.waitUntilReady(),
      this.queue.waitUntilReady(),
    ]);
    await this.queue.upsertJobScheduler(
      ACTIVATION_NUDGE_SCHEDULER_ID,
      { every: intervalMs },
      { name: ACTIVATION_NUDGE_JOB_NAME, opts: JOB_OPTIONS },
    );
    this.logger.log(
      `Activation nudge scheduler started (every ${intervalMs}ms)`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
  }

  private isEnabled(): boolean {
    if (backgroundWorkersDisabled(this.configService)) return false;
    const override = this.configService.get<string>('ACTIVATION_NUDGE_ENABLED');
    if (override !== undefined) return override === 'true';
    return this.configService.get<string>('NODE_ENV') !== 'test';
  }

  private getIntervalMs(): number {
    const raw = this.configService.get<string>('ACTIVATION_NUDGE_INTERVAL_MS');
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INTERVAL_MS;
  }
}
