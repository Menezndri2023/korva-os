import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idToJson } from '../../core/mongoose/schema-options';

export type CustomerSessionDocument = HydratedDocument<CustomerSession>;

/**
 * Refresh-token session for a CustomerAccount — a deliberate fork of the staff Session schema
 * rather than a reuse: Session is keyed to a global User.userId (not org-scoped), while a
 * customer session is inherently (organizationId, contactId)-scoped, a real structural
 * difference, not a cosmetic one. Same rotation/hash-only-storage/reuse-detection shape as
 * Session otherwise (see SessionsRepository for the pattern this mirrors).
 */
@Schema({
  timestamps: true,
  collection: 'customer_sessions',
  toJSON: idToJson,
})
export class CustomerSession {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'CustomerAccount',
    required: true,
    index: true,
  })
  customerAccountId!: Types.ObjectId;

  @Prop({ required: true, index: true })
  refreshTokenHash!: string;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;
}

export const CustomerSessionSchema =
  SchemaFactory.createForClass(CustomerSession);
