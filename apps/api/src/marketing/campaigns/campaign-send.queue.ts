export const CAMPAIGN_SEND_QUEUE_NAME = 'campaign-sends';

export interface CampaignSendJobData {
  organizationId: string;
  campaignId: string;
  recipientId: string;
  contactId: string;
}

/**
 * 3 attempts, exponential-from-2s — modeled on WEBHOOK_DELIVERY_JOB_OPTIONS but with a smaller
 * budget: a contact send has no "partner endpoint might recover" story the way a webhook
 * delivery does, so fewer retries are warranted. Retries are only safe here because
 * CampaignSendWorkerService guards every write on the recipient's status still being 'pending'
 * (sendWithChannelFallback never throws, so nothing else would prevent a duplicate real send on
 * a transient post-send DB failure without that guard) — see that service's own doc comment.
 */
export const CAMPAIGN_SEND_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 24 * 3600, count: 5000 },
  removeOnFail: false,
} as const;
