import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { PurchaseOrderStatus } from '@korva/types';
import { PURCHASE_ORDER_STATUSES } from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';

export type PurchaseOrderDocument = HydratedDocument<PurchaseOrder>;

@Schema({ _id: false })
export class PurchaseOrderLineItem {
  @Prop({ type: Types.ObjectId, ref: 'Offer', required: true })
  offerId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId })
  variantId?: Types.ObjectId;

  /** Snapshot of the offer's (or variant's) name at PO-creation time — same
   *  snapshot-at-creation convention as Order/Cart/Quote line items. */
  @Prop({ required: true })
  name!: string;

  @Prop({ required: true, min: 1 })
  quantity!: number;

  @Prop({ required: true, min: 0 })
  unitCost!: number;

  /** How much of `quantity` has arrived so far — see PurchaseOrdersService.receive for the
   *  partial-delivery flow this backs. */
  @Prop({ required: true, min: 0, default: 0 })
  receivedQuantity!: number;
}
export const PurchaseOrderLineItemSchema = SchemaFactory.createForClass(
  PurchaseOrderLineItem,
);

/**
 * A supplier restock order: draft (editable, no side effects) -> ordered (sent, awaiting
 * delivery) -> received (stock incremented, terminal) or cancelled (terminal, from draft/ordered
 * — never from received, an already-stocked delivery can't be un-cancelled). Receiving is the
 * ONLY transition that touches Offer.stockOnHand; see PurchaseOrdersService.receive for the
 * documented cross-line-item atomicity gap (mirrors CohortsService.scheduleSession's own
 * accepted v1 gap for the same reason: N independent single-document writes, not one
 * transaction).
 */
@Schema({ timestamps: true, collection: 'purchase_orders', toJSON: idToJson })
export class PurchaseOrder {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Supplier', required: true, index: true })
  supplierId!: Types.ObjectId;

  @Prop({ type: [PurchaseOrderLineItemSchema], required: true })
  items!: PurchaseOrderLineItem[];

  @Prop({
    type: String,
    enum: PURCHASE_ORDER_STATUSES,
    default: 'draft',
    index: true,
  })
  status!: PurchaseOrderStatus;

  @Prop({ required: true })
  currency!: string;

  @Prop()
  expectedDate?: Date;

  @Prop()
  notes?: string;

  @Prop()
  receivedAt?: Date;
}

export const PurchaseOrderSchema = SchemaFactory.createForClass(PurchaseOrder);
PurchaseOrderSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
