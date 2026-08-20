import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { QuoteStatus } from '@korva/types';
import { QUOTE_STATUSES } from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';
import { LineItem, LineItemSchema } from '../../shared/line-item.schema';

export type QuoteDocument = HydratedDocument<Quote>;

@Schema({ timestamps: true, collection: 'quotes', toJSON: idToJson })
export class Quote {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Contact', required: true, index: true })
  contactId!: Types.ObjectId;

  @Prop({ required: true })
  number!: string;

  @Prop({ type: String, enum: QUOTE_STATUSES, default: 'draft' })
  status!: QuoteStatus;

  @Prop({ type: [LineItemSchema], required: true })
  items!: LineItem[];

  @Prop({ required: true })
  currency!: string;

  @Prop({ required: true })
  subtotal!: number;

  @Prop({ required: true })
  taxTotal!: number;

  @Prop({ required: true })
  total!: number;

  @Prop()
  validUntil?: Date;

  @Prop()
  notes?: string;
}

export const QuoteSchema = SchemaFactory.createForClass(Quote);
QuoteSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
QuoteSchema.index({ organizationId: 1, number: 1 }, { unique: true });
