import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { FulfillmentMode, OrderSource, OrderStatus } from '@korva/types';
import { FULFILLMENT_MODES, ORDER_SOURCES, ORDER_STATUSES } from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';
import { LineItem, LineItemSchema } from '../../../shared/line-item.schema';

export type OrderDocument = HydratedDocument<Order>;

@Schema({ _id: false })
export class ShippingAddress {
  @Prop({ required: true })
  line1!: string;

  @Prop()
  line2?: string;

  @Prop({ required: true })
  city!: string;

  @Prop({ required: true })
  postalCode!: string;

  @Prop({ required: true })
  country!: string;
}
export const ShippingAddressSchema =
  SchemaFactory.createForClass(ShippingAddress);

@Schema({ timestamps: true, collection: 'orders', toJSON: idToJson })
export class Order {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Contact', required: true, index: true })
  contactId!: Types.ObjectId;

  @Prop({ required: true })
  number!: string;

  @Prop({ type: String, enum: ORDER_STATUSES, default: 'pending' })
  status!: OrderStatus;

  @Prop({ type: String, enum: ORDER_SOURCES, default: 'manual' })
  source!: OrderSource;

  @Prop({ type: Types.ObjectId, ref: 'Booking' })
  bookingId?: Types.ObjectId;

  /** Reuses Resource as a physical table — same "never fork the generic model" precedent as
   *  Resource.type staying free-form. Any organization can tag an order to a resource; a
   *  restaurant just benefits most (one open tab per table). */
  @Prop({ type: Types.ObjectId, ref: 'Resource' })
  resourceId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Invoice' })
  invoiceId?: Types.ObjectId;

  @Prop({ type: [LineItemSchema], required: true })
  items!: LineItem[];

  @Prop({ required: true })
  currency!: string;

  @Prop({ required: true })
  subtotal!: number;

  @Prop({ required: true })
  taxTotal!: number;

  @Prop({ type: Types.ObjectId, ref: 'DiscountCode' })
  discountCodeId?: Types.ObjectId;

  @Prop({ default: 0 })
  discountTotal!: number;

  /** Flat rate, resolved server-side from Organization.shippingFlatRate at order-creation time
   *  (a snapshot, like every other price on this document) — never client-supplied. Folded into
   *  `total` on top of the line-item totals, since shipping isn't a line item itself. */
  @Prop({ default: 0 })
  shippingCost!: number;

  @Prop({ type: ShippingAddressSchema })
  shippingAddress?: ShippingAddress;

  @Prop({ required: true })
  total!: number;

  @Prop()
  notes?: string;

  /** See Order.fulfillmentMode in @korva/types. */
  @Prop({ type: String, enum: FULFILLMENT_MODES })
  fulfillmentMode?: FulfillmentMode;

  @Prop()
  deliveryZoneName?: string;

  @Prop()
  requestedFor?: Date;

  @Prop()
  tableLabel?: string;
}

export const OrderSchema = SchemaFactory.createForClass(Order);
OrderSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
OrderSchema.index({ organizationId: 1, number: 1 }, { unique: true });
OrderSchema.index({ organizationId: 1, contactId: 1 });
