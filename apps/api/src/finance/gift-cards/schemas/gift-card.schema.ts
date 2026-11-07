import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idToJson } from '../../../core/mongoose/schema-options';

@Schema({ _id: false, timestamps: false })
export class GiftCardUse {
  @Prop({ type: Types.ObjectId, ref: 'Invoice', required: true })
  invoiceId!: Types.ObjectId;

  @Prop({ required: true })
  amount!: number;

  @Prop({ required: true })
  at!: Date;
}
const GiftCardUseSchema = SchemaFactory.createForClass(GiftCardUse);

/**
 * Une carte cadeau (2026-11-07): an amount the business sold or offered, spent on one or several
 * invoices until its balance is used. Its code is what the customer types; the balance only ever
 * moves through GiftCardsService (an atomic debit that never goes below zero).
 */
@Schema({ timestamps: true, collection: 'gift_cards', toJSON: idToJson })
export class GiftCard {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ required: true })
  code!: string;

  @Prop({ required: true })
  initialAmount!: number;

  @Prop({ required: true })
  balance!: number;

  @Prop({ required: true })
  currency!: string;

  @Prop({ type: String, enum: ['active', 'disabled'], default: 'active' })
  status!: 'active' | 'disabled';

  @Prop()
  recipientName?: string;

  @Prop()
  recipientEmail?: string;

  @Prop()
  message?: string;

  @Prop({ type: Date, default: null })
  expiresAt!: Date | null;

  @Prop({ type: [GiftCardUseSchema], default: [] })
  uses!: GiftCardUse[];
}

export type GiftCardDocument = HydratedDocument<GiftCard>;
export const GiftCardSchema = SchemaFactory.createForClass(GiftCard);
GiftCardSchema.index({ organizationId: 1, code: 1 }, { unique: true });
