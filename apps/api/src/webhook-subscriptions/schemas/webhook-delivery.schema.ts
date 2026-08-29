import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { SystemEvent, WebhookDeliveryStatus } from '@korva/types';
import { idToJson } from '../../core/mongoose/schema-options';

export type WebhookDeliveryDocument = HydratedDocument<WebhookDelivery>;

/**
 * One row per event dispatched to one subscription — created 'pending' the instant
 * WebhookDispatchService enqueues the delivery job, then updated in place by
 * WebhookDeliveryWorker as BullMQ retries happen, to a terminal 'success'/'failed'. This is the
 * "dedicated delivery log" a partner-integration admin needs to self-serve debugging — the gap
 * the Workflow Engine's own generic WorkflowExecution log doesn't fill (it's shared across every
 * action type, carries no response status, and isn't scoped to a subscription at all).
 */
@Schema({
  timestamps: true,
  collection: 'webhook_deliveries',
  toJSON: idToJson,
})
export class WebhookDelivery {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'WebhookSubscription',
    required: true,
    index: true,
  })
  subscriptionId!: Types.ObjectId;

  @Prop({ required: true })
  eventName!: SystemEvent;

  @Prop({ type: Object, required: true })
  payload!: Record<string, unknown>;

  @Prop({
    type: String,
    enum: ['pending', 'success', 'failed'],
    default: 'pending',
  })
  status!: WebhookDeliveryStatus;

  @Prop({ default: 0 })
  attempts!: number;

  @Prop()
  responseStatus?: number;

  @Prop()
  error?: string;
}

export const WebhookDeliverySchema =
  SchemaFactory.createForClass(WebhookDelivery);
WebhookDeliverySchema.index({ subscriptionId: 1, createdAt: -1 });
