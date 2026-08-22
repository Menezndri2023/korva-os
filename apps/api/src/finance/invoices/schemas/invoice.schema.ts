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
// `orderId` is optional — invoices from quotes/manual creation never set it. A partial unique
// index enforces "at most one invoice per order" only among documents that DO have an
// orderId, leaving every orderId-less invoice unaffected (MongoDB 7 / Mongoose 8: standard
// partialFilterExpression support). This is defense-in-depth alongside the conditional
// Order.invoiceId update in OrdersService.generateInvoice — see the transaction there for why
// that conditional update is already sufficient on its own under MongoDB's write-conflict
// semantics; this index guards every other path that could ever insert an Invoice with an
// orderId (direct repository use, future code, manual writes).
InvoiceSchema.index(
  { orderId: 1 },
  { unique: true, partialFilterExpression: { orderId: { $exists: true } } },
);
