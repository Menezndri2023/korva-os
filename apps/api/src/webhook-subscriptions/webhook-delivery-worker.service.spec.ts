import type { Job } from 'bullmq';
import type { ConfigService } from '@nestjs/config';
import { WebhookDeliveryWorkerService } from './webhook-delivery-worker.service';
import type { WebhookSubscriptionsRepository } from './webhook-subscriptions.repository';
import type { WebhookDeliveriesRepository } from './webhook-deliveries.repository';
import type { CredentialEncryptionService } from '../shared/crypto/credential-encryption.service';
import type { WebhookDeliveryJobData } from './webhook-delivery.queue';
import * as safeFetchModule from '../shared/safe-fetch';

const SUBSCRIPTION_ID = 'sub-1';
const DELIVERY_ID = 'delivery-1';

function buildService() {
  const configService = {} as unknown as ConfigService;

  const findByIdWithSecret = jest.fn();
  const recordDeliveryOutcome = jest.fn().mockResolvedValue(undefined);
  const subscriptionsRepository = {
    findByIdWithSecret,
    recordDeliveryOutcome,
  } as unknown as WebhookSubscriptionsRepository;

  const update = jest.fn().mockResolvedValue(undefined);
  const deliveriesRepository = {
    update,
  } as unknown as WebhookDeliveriesRepository;

  const decrypt = jest.fn().mockReturnValue('whsec_plaintext');
  const credentialEncryptionService = {
    decrypt,
  } as unknown as CredentialEncryptionService;

  const service = new WebhookDeliveryWorkerService(
    configService,
    subscriptionsRepository,
    deliveriesRepository,
    credentialEncryptionService,
  );

  return {
    service,
    findByIdWithSecret,
    recordDeliveryOutcome,
    update,
    decrypt,
  };
}

function buildJob(
  data: WebhookDeliveryJobData,
  attemptsMade: number,
  attempts: number,
): Job<WebhookDeliveryJobData> {
  return {
    data,
    attemptsMade,
    opts: { attempts },
  } as unknown as Job<WebhookDeliveryJobData>;
}

const JOB_DATA: WebhookDeliveryJobData = {
  deliveryId: DELIVERY_ID,
  subscriptionId: SUBSCRIPTION_ID,
  eventName: 'lead.created',
  payload: { leadId: 'lead-1' },
};

describe('WebhookDeliveryWorkerService.deliver', () => {
  let safeFetchSpy: jest.SpiedFunction<typeof safeFetchModule.safeFetch>;

  beforeEach(() => {
    safeFetchSpy = jest.spyOn(safeFetchModule, 'safeFetch');
  });
  afterEach(() => {
    safeFetchSpy.mockRestore();
  });

  async function deliver(
    job: Job<WebhookDeliveryJobData>,
    service: WebhookDeliveryWorkerService,
  ) {
    await (
      service as unknown as {
        deliver(job: Job<WebhookDeliveryJobData>): Promise<void>;
      }
    ).deliver(job);
  }

  it('signs the body, posts it, and records a successful delivery', async () => {
    const { service, findByIdWithSecret, recordDeliveryOutcome, update } =
      buildService();
    findByIdWithSecret.mockResolvedValue({
      active: true,
      url: 'https://partner.test/hook',
      secretEncrypted: 'enc',
    });
    safeFetchSpy.mockResolvedValue({ ok: true, status: 200 } as Response);

    await deliver(buildJob(JOB_DATA, 0, 5), service);

    expect(safeFetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = safeFetchSpy.mock.calls[0]!;
    expect(url).toBe('https://partner.test/hook');
    expect(init?.headers?.['X-Korva-Signature']).toMatch(
      /^sha256=[0-9a-f]{64}$/,
    );
    expect(init?.headers?.['X-Korva-Event']).toBe('lead.created');

    expect(update).toHaveBeenCalledWith(DELIVERY_ID, { attempts: 1 });
    expect(update).toHaveBeenCalledWith(DELIVERY_ID, {
      status: 'success',
      responseStatus: 200,
    });
    expect(recordDeliveryOutcome).toHaveBeenCalledWith(
      SUBSCRIPTION_ID,
      'success',
    );
  });

  it('retries (throws, does not mark terminal failure) on a non-final failed attempt', async () => {
    const { service, recordDeliveryOutcome, update, findByIdWithSecret } =
      buildService();
    findByIdWithSecret.mockResolvedValue({
      active: true,
      url: 'https://partner.test/hook',
      secretEncrypted: 'enc',
    });
    safeFetchSpy.mockResolvedValue({ ok: false, status: 500 } as Response);

    await expect(deliver(buildJob(JOB_DATA, 0, 5), service)).rejects.toThrow(
      'Webhook delivery failed with status 500',
    );

    expect(update).toHaveBeenCalledWith(
      DELIVERY_ID,
      expect.objectContaining({ responseStatus: 500 }),
    );
    expect(update).not.toHaveBeenCalledWith(
      DELIVERY_ID,
      expect.objectContaining({ status: 'failed' }),
    );
    expect(recordDeliveryOutcome).not.toHaveBeenCalled();
  });

  it('marks the delivery terminally failed on the final attempt, without retrying further', async () => {
    const { service, recordDeliveryOutcome, update, findByIdWithSecret } =
      buildService();
    findByIdWithSecret.mockResolvedValue({
      active: true,
      url: 'https://partner.test/hook',
      secretEncrypted: 'enc',
    });
    safeFetchSpy.mockResolvedValue({ ok: false, status: 500 } as Response);

    // attemptsMade=4 + 1 = attempt 5, the configured max — this IS the final attempt.
    await expect(deliver(buildJob(JOB_DATA, 4, 5), service)).rejects.toThrow();

    expect(update).toHaveBeenCalledWith(
      DELIVERY_ID,
      expect.objectContaining({ status: 'failed', responseStatus: 500 }),
    );
    expect(recordDeliveryOutcome).toHaveBeenCalledWith(
      SUBSCRIPTION_ID,
      'failed',
    );
  });

  it('fails terminally without retrying when the subscription is no longer active', async () => {
    const { service, recordDeliveryOutcome, update, findByIdWithSecret } =
      buildService();
    findByIdWithSecret.mockResolvedValue({
      active: false,
      url: 'https://partner.test/hook',
      secretEncrypted: 'enc',
    });

    await deliver(buildJob(JOB_DATA, 0, 5), service);

    expect(safeFetchSpy).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      DELIVERY_ID,
      expect.objectContaining({ status: 'failed' }),
    );
    expect(recordDeliveryOutcome).toHaveBeenCalledWith(
      SUBSCRIPTION_ID,
      'failed',
    );
  });
});
