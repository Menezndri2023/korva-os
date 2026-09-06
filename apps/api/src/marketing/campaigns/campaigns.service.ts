import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { Types } from 'mongoose';
import type {
  CreateCampaignInput,
  UpdateCampaignInput,
} from '@korva/validation';
import type { Pagination } from '@korva/types';
import {
  CampaignsRepository,
  FindCampaignsOptions,
} from './campaigns.repository';
import {
  CampaignRecipientsRepository,
  FindCampaignRecipientsOptions,
} from './campaign-recipients.repository';
import { CampaignDocument } from './schemas/campaign.schema';
import { CampaignRecipientDocument } from './schemas/campaign-recipient.schema';
import {
  CAMPAIGN_SEND_JOB_OPTIONS,
  CAMPAIGN_SEND_QUEUE_NAME,
  CampaignSendJobData,
} from './campaign-send.queue';
import { SegmentsService } from '../segments/segments.service';
import { AuditService } from '../../audit/audit.service';
import { EventBusService } from '../../core/events/event-bus.service';

/** Contacts are chunked before insertMany/addBulk so a large segment never builds one giant
 *  in-memory array of BullMQ job payloads or a single oversized insertMany call. */
const LAUNCH_CHUNK_SIZE = 500;

@Injectable()
export class CampaignsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CampaignsService.name);
  private connection?: IORedis;
  private queue?: Queue<CampaignSendJobData>;

  constructor(
    private readonly configService: ConfigService,
    private readonly campaignsRepository: CampaignsRepository,
    private readonly campaignRecipientsRepository: CampaignRecipientsRepository,
    private readonly segmentsService: SegmentsService,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBusService,
  ) {}

  onModuleInit(): void {
    this.connection = new IORedis(
      this.configService.getOrThrow<string>('REDIS_URL'),
      { maxRetriesPerRequest: null },
    );
    this.queue = new Queue<CampaignSendJobData>(CAMPAIGN_SEND_QUEUE_NAME, {
      connection: this.connection,
    });
    this.queue.on('error', (err) => {
      this.logger.error('Campaign send queue connection error', err);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
    this.connection?.disconnect();
  }

  async create(
    organizationId: string,
    input: CreateCampaignInput,
  ): Promise<CampaignDocument> {
    // 404s naturally via SegmentsService.getById if the segment doesn't belong to this org.
    await this.segmentsService.getById(organizationId, input.segmentId);
    return this.campaignsRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      name: input.name,
      segmentId: new Types.ObjectId(input.segmentId),
      subject: input.subject,
      body: input.body,
    });
  }

  async getById(organizationId: string, id: string): Promise<CampaignDocument> {
    const campaign = await this.campaignsRepository.findById(
      organizationId,
      id,
    );
    if (!campaign) {
      throw new NotFoundException({
        code: 'CAMPAIGN_NOT_FOUND',
        message: 'Campaign not found',
      });
    }
    return campaign;
  }

  async list(
    organizationId: string,
    query: FindCampaignsOptions,
  ): Promise<{ data: CampaignDocument[]; pagination: Pagination }> {
    const { data, total } = await this.campaignsRepository.findAll(
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
    id: string,
    input: UpdateCampaignInput,
  ): Promise<CampaignDocument> {
    const campaign = await this.getById(organizationId, id);
    if (campaign.status !== 'draft') {
      throw new BadRequestException({
        code: 'CAMPAIGN_NOT_EDITABLE',
        message: 'Only a draft campaign can be edited',
      });
    }
    if (input.segmentId) {
      await this.segmentsService.getById(organizationId, input.segmentId);
    }
    const updated = await this.campaignsRepository.update(organizationId, id, {
      name: input.name,
      segmentId: input.segmentId
        ? new Types.ObjectId(input.segmentId)
        : undefined,
      subject: input.subject,
      body: input.body,
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'CAMPAIGN_NOT_FOUND',
        message: 'Campaign not found',
      });
    }
    return updated;
  }

  async listRecipients(
    organizationId: string,
    campaignId: string,
    query: FindCampaignRecipientsOptions,
  ): Promise<{ data: CampaignRecipientDocument[]; pagination: Pagination }> {
    await this.getById(organizationId, campaignId); // 404s if not found/wrong org
    const { data, total } = await this.campaignRecipientsRepository.findAll(
      organizationId,
      campaignId,
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

  async launch(
    organizationId: string,
    userId: string,
    campaignId: string,
  ): Promise<CampaignDocument> {
    const campaign = await this.getById(organizationId, campaignId);
    if (campaign.status !== 'draft') {
      throw new BadRequestException({
        code: 'CAMPAIGN_ALREADY_SENT',
        message: `This campaign has already been ${campaign.status === 'sending' ? 'launched' : 'sent'}`,
      });
    }

    const segment = await this.segmentsService.getById(
      organizationId,
      campaign.segmentId.toString(),
    );
    const contactIds = await this.segmentsService.matchContactIds(
      organizationId,
      segment.criteria,
    );

    const launched = await this.campaignsRepository.markLaunching(
      organizationId,
      campaignId,
      contactIds.length,
    );
    if (!launched) {
      throw new BadRequestException({
        code: 'CAMPAIGN_ALREADY_SENT',
        message: 'This campaign has already been launched',
      });
    }

    for (let i = 0; i < contactIds.length; i += LAUNCH_CHUNK_SIZE) {
      const chunk = contactIds.slice(i, i + LAUNCH_CHUNK_SIZE);
      const recipients = await this.campaignRecipientsRepository.insertMany(
        chunk.map((contactId) => ({
          organizationId: new Types.ObjectId(organizationId),
          campaignId: new Types.ObjectId(campaignId),
          contactId: new Types.ObjectId(contactId),
          status: 'pending' as const,
        })),
      );
      if (this.queue) {
        await this.queue.addBulk(
          recipients.map((recipient) => ({
            name: 'send',
            data: {
              organizationId,
              campaignId,
              recipientId: recipient.id as string,
              contactId: recipient.contactId.toString(),
            },
            opts: CAMPAIGN_SEND_JOB_OPTIONS,
          })),
        );
      }
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'campaign',
      entityId: campaignId,
      metadata: { status: 'sending', totalRecipients: contactIds.length },
    });

    await this.eventBus.publish(organizationId, 'campaign.launched', {
      campaignId,
      segmentId: segment.id as string,
      totalRecipients: contactIds.length,
    });

    // Zero-recipient edge case: no worker will ever fire the completion path, so complete here.
    if (contactIds.length === 0) {
      await this.campaignsRepository.markCompleted(campaignId);
      await this.eventBus.publish(organizationId, 'campaign.completed', {
        campaignId,
        sentCount: 0,
        failedCount: 0,
      });
    }

    return this.getById(organizationId, campaignId);
  }
}
