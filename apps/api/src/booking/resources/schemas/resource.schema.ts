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
}

export const ResourceSchema = SchemaFactory.createForClass(Resource);
ResourceSchema.index({ organizationId: 1, active: 1 });
