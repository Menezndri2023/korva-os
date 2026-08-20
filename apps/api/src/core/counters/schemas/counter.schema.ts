import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CounterDocument = HydratedDocument<Counter>;

/** Generic atomic per-organization sequence generator (quote/invoice/order numbers, etc.). */
@Schema({ collection: 'counters' })
export class Counter {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ required: true })
  key!: string;

  @Prop({ default: 0 })
  seq!: number;
}

export const CounterSchema = SchemaFactory.createForClass(Counter);
CounterSchema.index({ organizationId: 1, key: 1 }, { unique: true });
