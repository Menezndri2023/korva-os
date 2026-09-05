import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { CartStatus } from '@korva/types';
import { CART_STATUSES } from '@korva/types';

export type CartDocument = HydratedDocument<Cart>;

@Schema({ _id: true })
export class CartItem {
  _id?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Offer', required: true })
  offerId!: Types.ObjectId;

  @Prop({ required: true })
  quantity!: number;
}
export const CartItemSchema = SchemaFactory.createForClass(CartItem);

@Schema({
  timestamps: true,
  collection: 'carts',
  toJSON: {
    virtuals: true,
    transform: (_doc, ret: Record<string, unknown>) => {
      ret.id = String(ret._id);
      delete ret._id;
      delete ret.__v;
      if (Array.isArray(ret.items)) {
        ret.items = (ret.items as Record<string, unknown>[]).map((item) => {
          const { _id, ...rest } = item;
          return { id: String(_id), ...rest };
        });
      }
      return ret;
    },
  },
})
export class Cart {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Contact', required: true, index: true })
  contactId!: Types.ObjectId;

  @Prop({ type: String, enum: CART_STATUSES, default: 'open' })
  status!: CartStatus;

  @Prop({ type: [CartItemSchema], default: [] })
  items!: CartItem[];

  /** Set by AbandonedCartReminderSchedulerService when it sends a recovery message and
   *  transitions status to 'abandoned' — dedup marker for that episode, mirroring
   *  Booking.reminderSentAt's role exactly. */
  @Prop({ type: Date })
  notifiedAt?: Date;
}

export const CartSchema = SchemaFactory.createForClass(Cart);
CartSchema.index({ organizationId: 1, contactId: 1, status: 1 });
