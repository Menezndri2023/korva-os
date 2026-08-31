import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { LineItemInput } from '@korva/validation';

/** A named add-on/variation with a per-unit price delta (e.g. "sans oignon": 0, "extra fromage":
 *  +1.50) — generic, not restaurant-specific (any vertical selling configurable items, from
 *  e-commerce add-ons to salon service extras, can reuse this identically). */
@Schema({ _id: false })
export class LineItemModifier {
  @Prop({ required: true })
  name!: string;

  @Prop({ required: true })
  priceDelta!: number;
}
export const LineItemModifierSchema =
  SchemaFactory.createForClass(LineItemModifier);

/**
 * Shared across Finance (Quote/Invoice) and Commerce (Order) — a quote line,
 * invoice line, and order line all have the same shape (per spec section 18,
 * Order is the generic commercial transaction shared by Booking and Commerce).
 */
@Schema({ _id: false })
export class LineItem {
  @Prop({ type: Types.ObjectId, ref: 'Offer' })
  offerId?: Types.ObjectId;

  // Not a Mongoose ref — an Offer's variants are subdocuments (their own auto-generated `_id`
  // within Offer.variants), not a top-level collection, so this is stored as a plain string
  // snapshot of that subdocument id rather than a `ref`.
  @Prop()
  variantId?: string;

  @Prop({ required: true })
  description!: string;

  @Prop({ required: true })
  quantity!: number;

  @Prop({ required: true })
  unitPrice!: number;

  @Prop()
  taxRate?: number;

  // `default: undefined` is required here, not redundant — Mongoose array paths implicitly
  // default to `[]` even with no `default` option at all, which would otherwise silently add a
  // `modifiers: []` key to every pre-existing LineItem document/assertion that never expected
  // one (confirmed the hard way — see this feature's own e2e run). Explicitly suppressing that
  // built-in default is the only way to keep this field genuinely absent when unset, matching
  // every other optional field on this schema (taxRate, offerId).
  @Prop({ type: [LineItemModifierSchema], default: undefined })
  modifiers?: LineItemModifier[];
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
    const modifiersDelta = (item.modifiers ?? []).reduce(
      (sum, modifier) => sum + modifier.priceDelta,
      0,
    );
    const lineAmount = item.quantity * (item.unitPrice + modifiersDelta);
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
    variantId: item.variantId,
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    taxRate: item.taxRate,
    modifiers: item.modifiers,
  }));
}
