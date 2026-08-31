import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idToJson } from '../../../core/mongoose/schema-options';

export type WishlistItemDocument = HydratedDocument<WishlistItem>;

/** One saved offer for one customer — a customer-portal-only concept (see the class doc on
 *  CustomerAccount for why this codebase forks a model only when genuinely customer-specific;
 *  a wishlist has no staff-facing analogue the way Cart/Order do). */
@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'wishlist_items',
  toJSON: idToJson,
})
export class WishlistItem {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Contact', required: true, index: true })
  contactId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Offer', required: true })
  offerId!: Types.ObjectId;
}

export const WishlistItemSchema = SchemaFactory.createForClass(WishlistItem);
// Adding the same offer twice is a silent no-op (see WishlistRepository.add), not an error —
// this unique index is what makes that atomic rather than a race between a read-then-write.
WishlistItemSchema.index(
  { organizationId: 1, contactId: 1, offerId: 1 },
  { unique: true },
);
