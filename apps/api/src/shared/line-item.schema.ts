import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { LineItemInput } from '@korva/validation';

/**
 * Shared across Finance (Quote/Invoice) and Commerce (Order) — a quote line,
 * invoice line, and order line all have the same shape (per spec section 18,
 * Order is the generic commercial transaction shared by Booking and Commerce).
 */
@Schema({ _id: false })
export class LineItem {
  @Prop({ type: Types.ObjectId, ref: 'Offer' })
  offerId?: Types.ObjectId;

  @Prop({ required: true })
  description!: string;

  @Prop({ required: true })
  quantity!: number;

  @Prop({ required: true })
  unitPrice!: number;

  @Prop()
  taxRate?: number;
}
export const LineItemSchema = SchemaFactory.createForClass(LineItem);

export interface LineItemTotals {
  subtotal: number;
  taxTotal: number;
  total: number;
}

/** Never trust totals from the client — always recompute server-side from the line items. */
export function computeTotals(items: LineItemInput[]): LineItemTotals {
  let subtotal = 0;
  let taxTotal = 0;

  for (const item of items) {
    const lineAmount = item.quantity * item.unitPrice;
    subtotal += lineAmount;
    taxTotal += lineAmount * ((item.taxRate ?? 0) / 100);
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  subtotal = round(subtotal);
  taxTotal = round(taxTotal);
  return { subtotal, taxTotal, total: round(subtotal + taxTotal) };
}

export function toLineItemDocs(items: LineItemInput[]): LineItem[] {
  return items.map((item) => ({
    offerId: item.offerId ? new Types.ObjectId(item.offerId) : undefined,
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    taxRate: item.taxRate,
  }));
}
