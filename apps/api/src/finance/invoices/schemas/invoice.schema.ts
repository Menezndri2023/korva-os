import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { InvoiceStatus } from '@korva/types';
import { INVOICE_STATUSES } from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';
import { LineItem, LineItemSchema } from '../../../shared/line-item.schema';

export type InvoiceDocument = HydratedDocument<Invoice>;

@Schema({ timestamps: true, collection: 'invoices', toJSON: idToJson })
export class Invoice {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Contact', required: true, index: true })
  contactId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Quote' })
  quoteId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Order' })
  orderId?: Types.ObjectId;

  @Prop({ required: true })
  number!: string;

  @Prop({ type: String, enum: INVOICE_STATUSES, default: 'draft' })
  status!: InvoiceStatus;

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

  @Prop({ default: 0 })
  amountPaid!: number;

  @Prop()
  dueDate?: Date;

  @Prop()
  issuedAt?: Date;

  @Prop()
  notes?: string;
}

export const InvoiceSchema = SchemaFactory.createForClass(Invoice);
InvoiceSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
InvoiceSchema.index({ organizationId: 1, number: 1 }, { unique: true });
