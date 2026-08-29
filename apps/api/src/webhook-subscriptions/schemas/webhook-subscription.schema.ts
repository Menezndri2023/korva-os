import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { SystemEvent, WebhookDeliveryStatus } from '@korva/types';
import { idToJson } from '../../core/mongoose/schema-options';

export type WebhookSubscriptionDocument = HydratedDocument<WebhookSubscription>;

/**
 * An org-configured outbound webhook — see packages/types/src/webhook-subscriptions.ts for the
 * "why this exists as a first-class entity, distinct from the Workflow Engine's own `webhook`
 * action" rationale. `secretEncrypted` must be decryptable (not just verifiable, unlike
 * ApiKey.keyHash) since WebhookDeliveryWorker needs the plaintext back to HMAC-sign every
 * delivery — see CredentialEncryptionService, the same encrypt/decrypt primitive
 * IntegrationAccount already uses for its own provider credentials.
 */
@Schema({
  timestamps: true,
  collection: 'webhook_subscriptions',
  toJSON: idToJson,
})
export class WebhookSubscription {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ required: true })
  url!: string;

  @Prop({ type: [String], required: true })
  events!: SystemEvent[];

  @Prop()
  description?: string;

  @Prop({ default: true })
  active!: boolean;

  /** "iv:authTag:ciphertext" — see CredentialEncryptionService. Never exposed in any API response. */
  @Prop({ required: true, select: false })
  secretEncrypted!: string;

  @Prop()
  lastDeliveryAt?: Date;

  @Prop({ type: String, enum: ['success', 'failed'] })
  lastDeliveryStatus?: Exclude<WebhookDeliveryStatus, 'pending'>;
}

export const WebhookSubscriptionSchema =
  SchemaFactory.createForClass(WebhookSubscription);
WebhookSubscriptionSchema.index({ organizationId: 1, active: 1 });
