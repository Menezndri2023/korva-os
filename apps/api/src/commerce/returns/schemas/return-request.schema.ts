import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { ReturnRequestStatus } from '@korva/types';
import { RETURN_REQUEST_STATUSES } from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';

export type ReturnRequestDocument = HydratedDocument<ReturnRequest>;

/** Snapshotted from the order's own line item at request-creation time (never client-supplied) —
 *  same snapshot principle as every other price on this codebase's documents. `lineItemIndex`
 *  is kept (not just offerId) so two distinct line items selling the same offer (e.g. two
 *  different sizes of the same product) can each be returned independently and so the
 *  already-returned-quantity guard in ReturnRequestsService can check the right line. */
@Schema({ _id: false })
export class ReturnRequestItem {
  @Prop({ required: true })
  lineItemIndex!: number;

  @Prop({ type: Types.ObjectId, ref: 'Offer' })
  offerId?: Types.ObjectId;

  @Prop()
  variantId?: string;

  @Prop({ required: true })
  description!: string;

  @Prop({ required: true })
  quantity!: number;

  @Prop({ required: true })
  unitPrice!: number;
}
export const ReturnRequestItemSchema =
  SchemaFactory.createForClass(ReturnRequestItem);

@Schema({
  timestamps: true,
  collection: 'return_requests',
  toJSON: idToJson,
})
export class ReturnRequest {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Order', required: true, index: true })
  orderId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Contact', required: true, index: true })
  contactId!: Types.ObjectId;

  @Prop({ type: [ReturnRequestItemSchema], required: true })
  items!: ReturnRequestItem[];

  @Prop({ required: true })
  reason!: string;

  @Prop({ type: String, enum: RETURN_REQUEST_STATUSES, default: 'pending' })
  status!: ReturnRequestStatus;

  /** Sum of items[].quantity * items[].unitPrice, computed server-side at creation time. */
  @Prop({ required: true })
  refundAmount!: number;

  @Prop({ required: true })
  currency!: string;

  @Prop({ type: Types.ObjectId, ref: 'Refund' })
  refundId?: Types.ObjectId;

  @Prop()
  rejectionReason?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  reviewedByUserId?: Types.ObjectId;

  @Prop()
  reviewedAt?: Date;
}

export const ReturnRequestSchema = SchemaFactory.createForClass(ReturnRequest);
ReturnRequestSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
ReturnRequestSchema.index({ organizationId: 1, orderId: 1 });
ReturnRequestSchema.index({ organizationId: 1, contactId: 1 });
