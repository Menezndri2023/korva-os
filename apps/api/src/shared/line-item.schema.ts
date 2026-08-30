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
  discountTotal: number;
  total: number;
}

export interface ResolvedDiscount {
  type: 'percentage' | 'fixed';
  value: number;
}

/**
 * Never trust totals from the client — always recompute server-side from the line items.
 * `discount`, when given, is applied against the pre-tax subtotal (tax is charged on the
 * undiscounted amount — a deliberate v1 simplification, not a compliance claim for every
 * jurisdiction; revisit if a tax-sensitive market needs discount-before-tax instead).
 */
export function computeTotals(
  items: LineItemInput[],
  discount?: ResolvedDiscount,
): LineItemTotals {
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

  let discountTotal = 0;
  if (discount) {
    const rawDiscount =
      discount.type === 'percentage'
        ? subtotal * (discount.value / 100)
        : discount.value;
    // Clamped so a fixed-amount discount larger than the order can never push total negative.
    discountTotal = round(Math.min(rawDiscount, subtotal + taxTotal));
  }

  return {
    subtotal,
    taxTotal,
    discountTotal,
    total: round(subtotal + taxTotal - discountTotal),
  };
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
