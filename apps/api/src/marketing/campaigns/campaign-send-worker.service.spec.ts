import type { Job } from 'bullmq';
import type { ConfigService } from '@nestjs/config';
import { CampaignSendWorkerService } from './campaign-send-worker.service';
import type { CampaignsRepository } from './campaigns.repository';
import type { CampaignRecipientsRepository } from './campaign-recipients.repository';
import type { ConversationsService } from '../../communication/conversations/conversations.service';
import type { ContactsService } from '../../crm/contacts/contacts.service';
import type { EventBusService } from '../../core/events/event-bus.service';
import type { CampaignSendJobData } from './campaign-send.queue';
import * as fallbackModule from '../../communication/notify-contact-with-fallback';

const ORGANIZATION_ID = 'org-1';
const CAMPAIGN_ID = 'campaign-1';
const RECIPIENT_ID = 'recipient-1';
const CONTACT_ID = 'contact-1';

const JOB_DATA: CampaignSendJobData = {
  organizationId: ORGANIZATION_ID,
  campaignId: CAMPAIGN_ID,
  recipientId: RECIPIENT_ID,
  contactId: CONTACT_ID,
};

function buildJob(): Job<CampaignSendJobData> {
  return { data: JOB_DATA } as unknown as Job<CampaignSendJobData>;
}

function buildService(options?: {
  recipientStatus?: string;
  processedCount?: number;
  totalRecipients?: number;
  recordOutcomeReturnsNull?: boolean;
}) {
  const configService = {} as unknown as ConfigService;

  const findById = jest.fn().mockResolvedValue({
    id: RECIPIENT_ID,
    status: options?.recipientStatus ?? 'pending',
  });
  const recordOutcome = jest
    .fn()
    .mockResolvedValue(
      options?.recordOutcomeReturnsNull ? null : { id: RECIPIENT_ID, status: 'sent' },
    );
  const campaignRecipientsRepository = {
    findById,
    recordOutcome,
  } as unknown as CampaignRecipientsRepository;

  const campaignFindById = jest.fn().mockResolvedValue({
    id: CAMPAIGN_ID,
    body: 'Hello {{contact.firstName}}',
  });
  const recordProgress = jest.fn().mockResolvedValue({
    stats: {
      processedCount: options?.processedCount ?? 1,
      totalRecipients: options?.totalRecipients ?? 1,
      sentCount: 1,
      failedCount: 0,
      skippedCount: 0,
    },
  });
  const markCompleted = jest.fn().mockResolvedValue({
    stats: { sentCount: 1, failedCount: 0, skippedCount: 0 },
  });
  const campaignsRepository = {
    findById: campaignFindById,
    recordProgress,
    markCompleted,
  } as unknown as CampaignsRepository;

  const getById = jest.fn().mockResolvedValue({
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.test',
    phone: undefined,
  });
  const contactsService = { getById } as unknown as ContactsService;

  const conversationsService = {} as unknown as ConversationsService;

  const publish = jest.fn().mockResolvedValue(undefined);
  const eventBus = { publish } as unknown as EventBusService;

  const service = new CampaignSendWorkerService(
    configService,
    campaignsRepository,
    campaignRecipientsRepository,
    conversationsService,
    contactsService,
    eventBus,
  );

  return {
    service,
    findById,
    recordOutcome,
    campaignFindById,
    recordProgress,
    markCompleted,
    getById,
    publish,
  };
}

async function send(service: CampaignSendWorkerService, job: Job<CampaignSendJobData>) {
  await (
    service as unknown as { send(job: Job<CampaignSendJobData>): Promise<void> }
  ).send(job);
}

describe('CampaignSendWorkerService.send', () => {
  let fallbackSpy: jest.SpiedFunction<typeof fallbackModule.sendWithChannelFallback>;

  beforeEach(() => {
    fallbackSpy = jest.spyOn(fallbackModule, 'sendWithChannelFallback');
  });
  afterEach(() => {
    fallbackSpy.mockRestore();
  });

  it('is a no-op — never sends, never records — when the recipient is no longer pending', async () => {
    const { service, findById, recordOutcome } = buildService({
      recipientStatus: 'sent',
    });
    fallbackSpy.mockResolvedValue('email');

    await send(service, buildJob());

    expect(findById).toHaveBeenCalledWith(RECIPIENT_ID);
    expect(fallbackSpy).not.toHaveBeenCalled();
    expect(recordOutcome).not.toHaveBeenCalled();
  });

  it('sends via the whatsapp-then-email fallback and records the outcome on success', async () => {
    const { service, recordOutcome } = buildService();
    fallbackSpy.mockResolvedValue('whatsapp');

    await send(service, buildJob());

    expect(fallbackSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      ORGANIZATION_ID,
      CONTACT_ID,
      'Hello Ada',
      'Campaign send',
    );
    expect(recordOutcome).toHaveBeenCalledWith(RECIPIENT_ID, 'sent', 'whatsapp');
  });

  it('records a failed outcome when every channel fails', async () => {
    const { service, recordOutcome } = buildService();
    fallbackSpy.mockResolvedValue(undefined);

    await send(service, buildJob());

    expect(recordOutcome).toHaveBeenCalledWith(RECIPIENT_ID, 'failed', undefined);
  });

  it('skips the campaign-level progress increment when recordOutcome no-ops (already processed by a prior attempt)', async () => {
    const { service, recordProgress } = buildService({
      recordOutcomeReturnsNull: true,
    });
    fallbackSpy.mockResolvedValue('email');

    await send(service, buildJob());

    expect(recordProgress).not.toHaveBeenCalled();
  });

  it('marks the campaign completed and publishes campaign.completed only when processedCount reaches totalRecipients', async () => {
    const { service, markCompleted, publish } = buildService({
      processedCount: 3,
      totalRecipients: 3,
    });
    fallbackSpy.mockResolvedValue('email');

    await send(service, buildJob());

    expect(markCompleted).toHaveBeenCalledWith(CAMPAIGN_ID);
    expect(publish).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      'campaign.completed',
      expect.objectContaining({ campaignId: CAMPAIGN_ID }),
    );
  });

  it('does not mark the campaign completed while recipients are still pending', async () => {
    const { service, markCompleted, publish } = buildService({
      processedCount: 2,
      totalRecipients: 5,
    });
    fallbackSpy.mockResolvedValue('email');

    await send(service, buildJob());

    expect(markCompleted).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('skips a recipient whose contact no longer exists, without ever attempting a send', async () => {
    const { service, getById, recordOutcome } = buildService();
    getById.mockRejectedValue(new Error('not found'));
    fallbackSpy.mockResolvedValue('email');

    await send(service, buildJob());

    expect(fallbackSpy).not.toHaveBeenCalled();
    expect(recordOutcome).toHaveBeenCalledWith(RECIPIENT_ID, 'skipped', undefined);
  });
});
