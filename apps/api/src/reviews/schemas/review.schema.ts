import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import type { ReviewEntity, ReviewStatus } from '@korva/types';
import { REVIEW_ENTITIES, REVIEW_STATUSES } from '@korva/types';
import { idToJson } from '../../core/mongoose/schema-options';

export type ReviewDocument = HydratedDocument<Review>;

const ReviewReplySchema = new MongooseSchema(
  {
    body: { type: String, required: true },
    repliedAt: { type: Date, required: true },
  },
  { _id: false },
);

/**
 * A customer's rating/comment on their own already-completed order or booking — written by the
 * customer, never by staff: from their account (CustomerAuthService#createReview) or from the
 * signed link sent after the order was delivered / the booking completed (no account needed —
 * see review-invitation-token.ts). Staff can read it (`orders.read`), answer it publicly and
 * take it off the site (`orders.update`), never edit it. At most one review per (contact,
 * entity, entityId) — see the unique index below.
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

  /** Absent on reviews written before moderation existed: they count as published. */
  @Prop({ type: String, enum: REVIEW_STATUSES })
  status?: ReviewStatus;

  /** "Awa K." — set only when the customer chose to sign with their first name. */
  @Prop()
  authorName?: string;

  /** The business's public answer, shown under the review. */
  @Prop({ type: ReviewReplySchema })
  reply?: { body: string; repliedAt: Date };
}

export const ReviewSchema = SchemaFactory.createForClass(Review);
ReviewSchema.index(
  { organizationId: 1, contactId: 1, entity: 1, entityId: 1 },
  { unique: true },
);
ReviewSchema.index({ organizationId: 1, createdAt: -1 });
ReviewSchema.index({ organizationId: 1, offerId: 1, createdAt: -1 });
