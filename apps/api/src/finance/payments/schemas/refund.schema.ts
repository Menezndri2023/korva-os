import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idToJson } from '../../../core/mongoose/schema-options';

export type RefundDocument = HydratedDocument<Refund>;

@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'refunds',
  toJSON: idToJson,
})
export class Refund {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Payment', required: true, index: true })
  paymentId!: Types.ObjectId;

  @Prop({ required: true })
  amount!: number;

  @Prop()
  reason?: string;
}

export const RefundSchema = SchemaFactory.createForClass(Refund);
