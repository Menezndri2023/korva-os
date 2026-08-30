import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ResourceDocument = HydratedDocument<Resource>;

@Schema({ _id: false })
export class WeeklyAvailabilityWindow {
  @Prop({ required: true, min: 0, max: 6 })
  dayOfWeek!: number;

  @Prop({ required: true })
  startTime!: string;

  @Prop({ required: true })
  endTime!: string;
}
export const WeeklyAvailabilityWindowSchema = SchemaFactory.createForClass(
  WeeklyAvailabilityWindow,
);

@Schema({ _id: true })
export class BlockedSlot {
  _id?: Types.ObjectId;

  @Prop({ required: true })
  startAt!: Date;

  @Prop({ required: true })
  endAt!: Date;

  @Prop()
  reason?: string;

  /**
   * Absent (undefined) for every manually-added blocked slot (the only kind that existed
   * before calendar sync) — only ever 'external_calendar' for slots CalendarSyncSchedulerService
   * itself wrote. That service wholesale-replaces exactly the slots carrying this marker on
   * every sync tick and never touches any other slot, so this is the one field that lets it
   * tell "mine" apart from "a human added this by hand" without an extra collection.
   */
  @Prop({ type: String, enum: ['external_calendar'] })
  source?: 'external_calendar';
}
export const BlockedSlotSchema = SchemaFactory.createForClass(BlockedSlot);

@Schema({
  timestamps: true,
  collection: 'resources',
  toJSON: {
    virtuals: true,
    transform: (_doc, ret: Record<string, unknown>) => {
      ret.id = String(ret._id);
      delete ret._id;
      delete ret.__v;
      if (Array.isArray(ret.blockedSlots)) {
        ret.blockedSlots = (ret.blockedSlots as Record<string, unknown>[]).map(
          (slot) => {
            const { _id, ...rest } = slot;
            return { id: String(_id), ...rest };
          },
        );
      }
      return ret;
    },
  },
})
export class Resource {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ required: true })
  name!: string;

  /** Free-form on purpose — person, vehicle, room, equipment, ... never a fixed sector-specific enum. */
  @Prop({ required: true })
  type!: string;

  @Prop({ default: 1 })
  capacity!: number;

  @Prop()
  description?: string;

  @Prop({ default: true })
  active!: boolean;

  @Prop({ type: [WeeklyAvailabilityWindowSchema], default: [] })
  weeklyAvailability!: WeeklyAvailabilityWindow[];

  @Prop({ type: [BlockedSlotSchema], default: [] })
  blockedSlots!: BlockedSlot[];

  /**
   * An ICS (iCalendar) feed URL — e.g. a staff member's Google/Outlook/Apple Calendar "secret
   * address" — CalendarSyncSchedulerService periodically fetches and turns into blocked slots
   * on this resource, so a personal appointment the business owner already has on their own
   * calendar blocks KORVA availability too. Validated as a safe (https, non-private-network)
   * URL at write time — see ResourcesService#update — using the exact same check already
   * applied to outgoing workflow webhook URLs (shared/safe-fetch.ts).
   */
  @Prop()
  externalCalendarUrl?: string;

  /**
   * Optional link to a real staff Membership — turns "book with Sophie" from a name string into
   * a queryable relationship, and lets commission/tip-attribution features later trace a
   * booking/order back to the staff member who performed it. Never required: every Resource
   * that isn't a person (a room, a vehicle, equipment) simply has none.
   */
  @Prop({ type: Types.ObjectId, ref: 'Membership' })
  membershipId?: Types.ObjectId;

  /**
   * Internal write-conflict trigger only — never read, no business meaning, kept out of API
   * responses via `select: false`. Every booking-creation transaction increments it (see
   * AvailabilityService.assertSlotAvailable) as part of the same MongoDB transaction that reads
   * overlapping bookings and inserts the new Booking document. Two concurrent booking-creation
   * transactions on the same resource both try to write this field, so MongoDB's WiredTiger
   * transaction machinery detects a real WriteConflict between them and forces the loser to
   * retry against a fresh snapshot (which by then includes the winner's committed booking) —
   * this is what closes the check-then-insert double-booking race in BookingsService.create().
   */
  @Prop({ default: 0, select: false })
  bookingLockVersion!: number;
}

export const ResourceSchema = SchemaFactory.createForClass(Resource);
ResourceSchema.index({ organizationId: 1, active: 1 });
