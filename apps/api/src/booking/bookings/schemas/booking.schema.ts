import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type {
  BookingCancelledBy,
  BookingPaymentStatus,
  BookingStatus,
} from '@korva/types';
import {
  BOOKING_CANCELLED_BY,
  BOOKING_PAYMENT_STATUSES,
  BOOKING_STATUSES,
} from '@korva/types';
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

  /** The deposit the customer was asked to pay online (Offer.depositPercent), and until when:
   *  unpaid past it, the booking is cancelled and the slot freed. */
  @Prop()
  depositAmount?: number;

  @Prop()
  depositDueBy?: Date;

  /** See Booking.nights in @korva/types — set on a stay only. */
  @Prop({ min: 1 })
  nights?: number;

  /** See Booking.partySize in @korva/types — a table booking's number of guests. */
  @Prop({ min: 1 })
  partySize?: number;

  /** See Booking.blockedUntil in @korva/types — endAt plus the offer's buffer. */
  @Prop()
  blockedUntil?: Date;

  @Prop()
  notes?: string;

  /** See Booking.reminderSentAt in @korva/types for the field-level rationale. */
  @Prop({ type: Date })
  reminderSentAt?: Date;

  /** See Booking.attended in @korva/types for the field-level rationale. */
  @Prop({ type: Boolean })
  attended?: boolean;

  /** See Booking.cancelledBy in @korva/types. */
  @Prop({ type: String, enum: BOOKING_CANCELLED_BY })
  cancelledBy?: BookingCancelledBy;

  /**
   * Snapshot of resource.membershipId at booking-creation time — NOT a live join. A later staff
   * reassignment on the Resource must never rewrite historical commission/attribution data, so
   * this is copied once and never re-derived. Absent when the resource had no staff link.
   */
  @Prop({ type: Types.ObjectId, ref: 'Membership' })
  staffMembershipId?: Types.ObjectId;
}

export const BookingSchema = SchemaFactory.createForClass(Booking);
BookingSchema.index({ organizationId: 1, resourceId: 1, startAt: 1 });
BookingSchema.index({ organizationId: 1, status: 1, startAt: -1 });
BookingSchema.index({ organizationId: 1, contactId: 1 });
// Supports BookingsRepository.findUpcomingUnreminded's global (org-agnostic) sweep query —
// same cross-tenant-scheduler shape as Quote/Invoice's own status+date indexes.
BookingSchema.index({ status: 1, startAt: 1, reminderSentAt: 1 });
