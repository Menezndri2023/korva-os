import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { ReviewEntity } from '@korva/types';
import { REVIEW_ENTITIES } from '@korva/types';
import { idToJson } from '../../core/mongoose/schema-options';

export type ReviewDocument = HydratedDocument<Review>;

/**
 * A customer's rating/comment on their own already-completed order or booking — created only
 * through the customer portal (see CustomerAuthService#createReview), never by staff. Read-only
 * for staff (ReviewsController, gated on the existing `orders.read` permission — a review is
 * inherently order/booking-adjacent, not important enough on its own to warrant a whole new
 * permission category). At most one review per (contact, entity, entityId) — see the unique
 * index below.
 */
@Schema({ timestamps: true, collection: 'reviews', toJSON: idToJson })
export class Review {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Contact', required: true })
  contactId!: Types.ObjectId;

  @Prop({ type: String, enum: REVIEW_ENTITIES, required: true })
  entity!: ReviewEntity;

  /** The Order or Booking id, depending on `entity` — deliberately not a typed `ref` since it
   *  points at one of two different collections. */
  @Prop({ type: Types.ObjectId, required: true })
  entityId!: Types.ObjectId;

  /** Resolved server-side at creation time (CustomerAuthService#createReview) — a booking's own
   *  `offerId` for a booking review; for an order review, the single distinct offerId across its
   *  line items, or left unset if the order mixed offers/free-text lines (no single product to
   *  attribute the review to). Powers the public "reviews for this offer" display; absent from
   *  older reviews created before this field existed, which is expected and handled as "not
   *  attributable to one offer" rather than backfilled. */
  @Prop({ type: Types.ObjectId, ref: 'Offer' })
  offerId?: Types.ObjectId;

  @Prop({ required: true, min: 1, max: 5 })
  rating!: number;

  @Prop()
  comment?: string;
}

export const ReviewSchema = SchemaFactory.createForClass(Review);
ReviewSchema.index(
  { organizationId: 1, contactId: 1, entity: 1, entityId: 1 },
  { unique: true },
);
ReviewSchema.index({ organizationId: 1, createdAt: -1 });
ReviewSchema.index({ organizationId: 1, offerId: 1, createdAt: -1 });
