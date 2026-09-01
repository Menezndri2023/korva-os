import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { KitchenTicketStatus } from '@korva/types';
import { KITCHEN_TICKET_STATUSES } from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';

export type KitchenTicketDocument = HydratedDocument<KitchenTicket>;

/** See @korva/types kitchen.ts's own doc comment for why this deliberately carries no item
 *  list — the order it's tied to is always the live source of truth for what's on it. */
@Schema({ timestamps: true, collection: 'kitchen_tickets', toJSON: idToJson })
export class KitchenTicket {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Order', required: true })
  orderId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Resource' })
  resourceId?: Types.ObjectId;

  @Prop({ type: String, enum: KITCHEN_TICKET_STATUSES, default: 'new' })
  status!: KitchenTicketStatus;
}

export const KitchenTicketSchema = SchemaFactory.createForClass(KitchenTicket);
KitchenTicketSchema.index({ organizationId: 1, orderId: 1 }, { unique: true });
KitchenTicketSchema.index({ organizationId: 1, status: 1, createdAt: 1 });
