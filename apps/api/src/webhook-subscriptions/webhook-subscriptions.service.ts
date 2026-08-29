import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type {
  CreateWebhookSubscriptionInput,
  ListWebhookDeliveriesQuery,
  UpdateWebhookSubscriptionInput,
} from '@korva/validation';
import { WebhookSubscriptionsRepository } from './webhook-subscriptions.repository';
import { WebhookDeliveriesRepository } from './webhook-deliveries.repository';
import { WebhookSubscriptionDocument } from './schemas/webhook-subscription.schema';
import { generateWebhookSecret } from './webhook-secret-generator.util';
import { CredentialEncryptionService } from '../shared/crypto/credential-encryption.service';
import {
  UnsafeWebhookUrlError,
  assertSafeWebhookUrl,
} from '../shared/safe-fetch';
import { AuditService } from '../audit/audit.service';

/** Same check already applied to the Workflow Engine's own webhook action and to Resource's
 *  externalCalendarUrl — an outbound-webhook URL is just as capable of being pointed at an
 *  internal service or cloud metadata endpoint. */
async function assertSafeSubscriptionUrl(url: string): Promise<void> {
  try {
    await assertSafeWebhookUrl(url);
  } catch (error) {
    if (error instanceof UnsafeWebhookUrlError) {
      throw new BadRequestException({
        code: 'UNSAFE_WEBHOOK_URL',
        message: error.message,
      });
    }
    throw error;
  }
}

@Injectable()
export class WebhookSubscriptionsService {
  constructor(
    private readonly subscriptionsRepository: WebhookSubscriptionsRepository,
    private readonly deliveriesRepository: WebhookDeliveriesRepository,
    private readonly credentialEncryptionService: CredentialEncryptionService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    organizationId: string,
    userId: string,
    input: CreateWebhookSubscriptionInput,
  ) {
    await assertSafeSubscriptionUrl(input.url);

    const secret = generateWebhookSecret();
    const subscription = await this.subscriptionsRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      url: input.url,
      events: input.events,
      description: input.description,
      secretEncrypted: this.credentialEncryptionService.encrypt(secret),
    });

    await this.auditService.record({
      organizationId,
      userId,
      action: 'SETTINGS_CHANGE',
      entity: 'webhook_subscription',
      entityId: subscription.id as string,
      metadata: { event: 'created', url: input.url, events: input.events },
    });

    return withSecret(subscription, secret);
  }

  list(organizationId: string): Promise<WebhookSubscriptionDocument[]> {
    return this.subscriptionsRepository.findByOrganization(organizationId);
  }

  async getById(
    organizationId: string,
    id: string,
  ): Promise<WebhookSubscriptionDocument> {
    const subscription =
      await this.subscriptionsRepository.findByIdForOrganization(
        id,
        organizationId,
      );
    if (!subscription) {
      throw new NotFoundException({
        code: 'WEBHOOK_SUBSCRIPTION_NOT_FOUND',
        message: 'Webhook subscription not found',
      });
    }
    return subscription;
  }

  async update(
    organizationId: string,
    userId: string,
    id: string,
    input: UpdateWebhookSubscriptionInput,
  ): Promise<WebhookSubscriptionDocument> {
    if (input.url) {
      await assertSafeSubscriptionUrl(input.url);
    }
    const updated = await this.subscriptionsRepository.update(
      organizationId,
      id,
      input,
    );
    if (!updated) {
      throw new NotFoundException({
        code: 'WEBHOOK_SUBSCRIPTION_NOT_FOUND',
        message: 'Webhook subscription not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'SETTINGS_CHANGE',
      entity: 'webhook_subscription',
      entityId: id,
      metadata: { event: 'updated' },
    });

    return updated;
  }

  async delete(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<void> {
    const deleted = await this.subscriptionsRepository.delete(
      organizationId,
      id,
    );
    if (!deleted) {
      throw new NotFoundException({
        code: 'WEBHOOK_SUBSCRIPTION_NOT_FOUND',
        message: 'Webhook subscription not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'SETTINGS_CHANGE',
      entity: 'webhook_subscription',
      entityId: id,
      metadata: { event: 'deleted' },
    });
  }

  /**
   * Same shape as ApiKeysService.rotate but without a revoke/reissue split — the subscription
   * itself stays the same document (same url/events/delivery history); only the secret changes,
   * returned once, same as `create`.
   */
  async rotateSecret(organizationId: string, userId: string, id: string) {
    const existing = await this.getById(organizationId, id);

    const secret = generateWebhookSecret();
    const updated = await this.subscriptionsRepository.update(
      organizationId,
      id,
      {
        secretEncrypted: this.credentialEncryptionService.encrypt(secret),
      },
    );
    if (!updated) {
      throw new NotFoundException({
        code: 'WEBHOOK_SUBSCRIPTION_NOT_FOUND',
        message: 'Webhook subscription not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'SETTINGS_CHANGE',
      entity: 'webhook_subscription',
      entityId: existing.id as string,
      metadata: { event: 'secret_rotated' },
    });

    return withSecret(updated, secret);
  }

  async listDeliveries(
    organizationId: string,
    subscriptionId: string,
    query: ListWebhookDeliveriesQuery,
  ) {
    // Confirmed to exist first so a foreign/unknown subscriptionId 404s instead of silently
    // returning an empty page — same "check then list" order as other detail+sub-resource pairs
    // in this codebase (e.g. ResourcesService.addBlockedSlot).
    await this.getById(organizationId, subscriptionId);
    return this.deliveriesRepository.findBySubscription(
      organizationId,
      subscriptionId,
      query.page,
      query.limit,
    );
  }
}

/** `subscription.toJSON()` runs the schema's idToJson transform (id + timestamps, no
 *  secretEncrypted — it was never loaded, being `select: false`); `secret` is layered on top only
 *  for this one response, same pattern as ApiKeysService.withPlaintext. */
function withSecret(subscription: WebhookSubscriptionDocument, secret: string) {
  return { ...subscription.toJSON(), secret };
}
