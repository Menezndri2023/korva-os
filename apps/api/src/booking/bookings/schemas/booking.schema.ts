import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { BookingPaymentStatus, BookingStatus } from '@korva/types';
import { BOOKING_PAYMENT_STATUSES, BOOKING_STATUSES } from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';

export type BookingDocument = HydratedDocument<Booking>;

@Schema({ _id: false })
export class BookingPricing {
  @Prop({ required: true })
  amount!: number;

  @Prop({ required: true })
  currency!: string;
}
export const BookingPricingSchema =
  SchemaFactory.createForClass(BookingPricing);

@Schema({ timestamps: true, collection: 'bookings', toJSON: idToJson })
export class Booking {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Resource', required: true, index: true })
  resourceId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Offer', required: true })
  offerId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Contact', required: true, index: true })
  contactId!: Types.ObjectId;

  @Prop({ required: true })
  startAt!: Date;

  @Prop({ required: true })
  endAt!: Date;

  @Prop({ type: String, enum: BOOKING_STATUSES, default: 'confirmed' })
  status!: BookingStatus;

  @Prop({ type: BookingPricingSchema, required: true })
  pricing!: BookingPricing;

  @Prop({ type: String, enum: BOOKING_PAYMENT_STATUSES, default: 'unpaid' })
  paymentStatus!: BookingPaymentStatus;

  @Prop()
  notes?: string;
}

export const BookingSchema = SchemaFactory.createForClass(Booking);
BookingSchema.index({ organizationId: 1, resourceId: 1, startAt: 1 });
BookingSchema.index({ organizationId: 1, status: 1, startAt: -1 });
BookingSchema.index({ organizationId: 1, contactId: 1 });
