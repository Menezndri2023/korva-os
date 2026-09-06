import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { interpolate } from '../../shared/template';
import { sendWithChannelFallback } from '../../communication/notify-contact-with-fallback';
import { ConversationsService } from '../../communication/conversations/conversations.service';
import { ContactsService } from '../../crm/contacts/contacts.service';
import { CampaignsRepository } from './campaigns.repository';
import { CampaignRecipientsRepository } from './campaign-recipients.repository';
import {
  CAMPAIGN_SEND_QUEUE_NAME,
  CampaignSendJobData,
} from './campaign-send.queue';
import { EventBusService } from '../../core/events/event-bus.service';

/**
 * Consumes the `campaign-sends` queue CampaignsService.launch enqueues into — split from it the
 * same way WebhookDeliveryWorkerService is split from WebhookDispatchService, so a slow/failing
 * send never blocks the (fast, enqueue-only) launch path.
 *
 * The single most important invariant here: `sendWithChannelFallback` never throws (it swallows
 * per-channel failures and returns undefined on total failure), so nothing else in this job would
 * naturally prevent a duplicate real send if a retry ran after a genuinely-successful send whose
 * DB write failed. `recordOutcome`'s `status:'pending'` filter clause is what makes retries safe —
 * every write below is a no-op once a prior attempt already recorded an outcome.
 */
@Injectable()
export class CampaignSendWorkerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(CampaignSendWorkerService.name);
  private connection?: IORedis;
  private worker?: Worker<CampaignSendJobData>;

  constructor(
    private readonly configService: ConfigService,
    private readonly campaignsRepository: CampaignsRepository,
    private readonly campaignRecipientsRepository: CampaignRecipientsRepository,
    private readonly conversationsService: ConversationsService,
    private readonly contactsService: ContactsService,
    private readonly eventBus: EventBusService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.connection = new IORedis(
      this.configService.getOrThrow<string>('REDIS_URL'),
      { maxRetriesPerRequest: null },
    );
    this.worker = new Worker<CampaignSendJobData>(
      CAMPAIGN_SEND_QUEUE_NAME,
      async (job) => this.send(job),
      { connection: this.connection },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(`Campaign send job ${job?.id} failed`, error);
    });
    this.worker.on('error', (err) => {
      this.logger.error('Campaign send queue worker connection error', err);
    });
    await this.worker.waitUntilReady();
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    this.connection?.disconnect();
  }

  private async send(job: Job<CampaignSendJobData>): Promise<void> {
    const { organizationId, campaignId, recipientId, contactId } = job.data;

    // Idempotency short-circuit: if a prior attempt already recorded an outcome, do nothing.
    const recipient =
      await this.campaignRecipientsRepository.findById(recipientId);
    if (!recipient || recipient.status !== 'pending') {
      return;
    }

    const campaign = await this.campaignsRepository.findById(
      organizationId,
      campaignId,
    );
    if (!campaign) {
      await this.recordAndMaybeComplete(
        organizationId,
        campaignId,
        recipientId,
        'skipped',
      );
      return;
    }

    let contact;
    try {
      contact = await this.contactsService.getById(organizationId, contactId);
    } catch {
      await this.recordAndMaybeComplete(
        organizationId,
        campaignId,
        recipientId,
        'skipped',
      );
      return;
    }

    const body = interpolate(campaign.body, {
      contact: {
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        phone: contact.phone,
      },
    });

    const channel = await sendWithChannelFallback(
      this.conversationsService,
      this.logger,
      organizationId,
      contactId,
      body,
      'Campaign send',
    );

    await this.recordAndMaybeComplete(
      organizationId,
      campaignId,
      recipientId,
      channel ? 'sent' : 'failed',
      channel,
    );
  }

  private async recordAndMaybeComplete(
    organizationId: string,
    campaignId: string,
    recipientId: string,
    outcome: 'sent' | 'failed' | 'skipped',
    channelUsed?: 'whatsapp' | 'email',
  ): Promise<void> {
    const recorded = await this.campaignRecipientsRepository.recordOutcome(
      recipientId,
      outcome,
      channelUsed,
    );
    // A prior attempt already recorded this recipient's outcome — never double-count the
    // campaign-level stats.
    if (!recorded) return;

    const updatedCampaign = await this.campaignsRepository.recordProgress(
      campaignId,
      outcome,
    );
    // The >= comparison (not ===), combined with this update happening in one atomic op per
    // recordOutcome-guarded call, is what guarantees exactly one worker ever observes "done" —
    // a separate read-then-compare would race under concurrently-finishing workers.
    if (
      updatedCampaign &&
      updatedCampaign.stats.processedCount >=
        updatedCampaign.stats.totalRecipients
    ) {
      const completed =
        await this.campaignsRepository.markCompleted(campaignId);
      if (completed) {
        await this.eventBus.publish(organizationId, 'campaign.completed', {
          campaignId,
          sentCount: completed.stats.sentCount,
          failedCount: completed.stats.failedCount,
        });
      }
    }
  }
}
