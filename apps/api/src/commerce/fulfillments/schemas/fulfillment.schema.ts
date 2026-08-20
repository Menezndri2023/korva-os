import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { FulfillmentStatus } from '@korva/types';
import { FULFILLMENT_STATUSES } from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';

export type FulfillmentDocument = HydratedDocument<Fulfillment>;

/** Architecture-ready per spec section 17 — no real carrier integration yet, just status tracking. */
@Schema({ timestamps: true, collection: 'fulfillments', toJSON: idToJson })
export class Fulfillment {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Order', required: true, index: true })
  orderId!: Types.ObjectId;

  @Prop({ type: String, enum: FULFILLMENT_STATUSES, default: 'pending' })
  status!: FulfillmentStatus;

  @Prop()
  carrier?: string;

  @Prop()
  trackingNumber?: string;

  @Prop()
  shippedAt?: Date;

  @Prop()
  deliveredAt?: Date;
}

export const FulfillmentSchema = SchemaFactory.createForClass(Fulfillment);
