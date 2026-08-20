import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { OrderSource, OrderStatus } from '@korva/types';
import { ORDER_SOURCES, ORDER_STATUSES } from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';
import { LineItem, LineItemSchema } from '../../../shared/line-item.schema';

export type OrderDocument = HydratedDocument<Order>;

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

  @Prop({ required: true })
  total!: number;

  @Prop()
  notes?: string;
}

export const OrderSchema = SchemaFactory.createForClass(Order);
OrderSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
OrderSchema.index({ organizationId: 1, number: 1 }, { unique: true });
OrderSchema.index({ organizationId: 1, contactId: 1 });
