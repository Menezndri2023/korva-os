import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idToJson } from '../../../core/mongoose/schema-options';

export const WAITLIST_ENTRY_STATUSES = [
  'waiting',
  'notified',
  'cancelled',
] as const;
export type WaitlistEntryStatus = (typeof WAITLIST_ENTRY_STATUSES)[number];

export type WaitlistEntryDocument = HydratedDocument<WaitlistEntry>;

/**
 * Generic — a resource/slot at capacity is a booking-module concept, not a Salon-specific one
 * (a restaurant table, a training-session seat, a rental vehicle could all use this identically).
 * Intentionally does not auto-create a Booking when a slot frees up: a human (staff, or the
 * contact themselves) still has to confirm and book — this only closes the "tell someone a spot
 * opened up" notification gap.
 */
@Schema({ timestamps: true, collection: 'waitlist_entries', toJSON: idToJson })
export class WaitlistEntry {
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

  @Prop({ type: Types.ObjectId, ref: 'Contact', required: true })
  contactId!: Types.ObjectId;

  /** The slot the contact actually wanted but couldn't get — used to match against the slot
   *  freed up by a later cancellation. */
  @Prop({ required: true })
  startAt!: Date;

  @Prop({ required: true })
  endAt!: Date;

  @Prop({ type: String, enum: WAITLIST_ENTRY_STATUSES, default: 'waiting' })
  status!: WaitlistEntryStatus;

  @Prop()
  notifiedAt?: Date;

  @Prop()
  notes?: string;
}

export const WaitlistEntrySchema = SchemaFactory.createForClass(WaitlistEntry);
WaitlistEntrySchema.index({
  organizationId: 1,
  resourceId: 1,
  status: 1,
  createdAt: 1,
});
WaitlistEntrySchema.index({ organizationId: 1, contactId: 1 });
