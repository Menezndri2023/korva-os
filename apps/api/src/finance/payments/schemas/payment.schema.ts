import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { PaymentStatus } from '@korva/types';
import { PAYMENT_STATUSES } from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';

export type PaymentDocument = HydratedDocument<Payment>;

@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'payments',
  toJSON: idToJson,
})
export class Payment {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Invoice', required: true, index: true })
  invoiceId!: Types.ObjectId;

  @Prop({ required: true })
  amount!: number;

  @Prop({ required: true })
  currency!: string;

  @Prop({ type: String, enum: PAYMENT_STATUSES, default: 'pending' })
  status!: PaymentStatus;

  @Prop({ required: true })
  provider!: string;

  @Prop()
  providerReference?: string;

  @Prop()
  method?: string;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);
PaymentSchema.index({ organizationId: 1, invoiceId: 1 });
