import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idToJson } from '../../../core/mongoose/schema-options';

/**
 * A day's till, closed: the cash counted in the drawer against what the day's cash payments say
 * should be there. One per organization and day (unique index, migration 0015) — a closing is a
 * record for the owner, never edited afterwards.
 */
@Schema({ timestamps: true, collection: 'till_closings', toJSON: idToJson })
export class TillClosing {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  /** YYYY-MM-DD in the organization's timezone. */
  @Prop({ required: true })
  day!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  closedBy!: Types.ObjectId;

  @Prop({ required: true })
  closedByName!: string;

  @Prop({ required: true })
  countedCash!: number;

  @Prop({ required: true })
  expectedCash!: number;

  @Prop({ required: true })
  total!: number;

  @Prop({ required: true })
  currency!: string;

  @Prop()
  note?: string;
}

export type TillClosingDocument = HydratedDocument<TillClosing>;
export const TillClosingSchema = SchemaFactory.createForClass(TillClosing);
TillClosingSchema.index({ organizationId: 1, day: -1 }, { unique: true });
